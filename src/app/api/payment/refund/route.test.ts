import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminApiAuth: vi.fn(),
  getAdminContext: vi.fn(),
  rpc: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  retrieveIntent: vi.fn(),
  logOps: vi.fn(),
  updates: [] as Array<{ table: string; values: unknown }>,
  reservation: null as Record<string, unknown> | null,
  refundRow: null as Record<string, unknown> | null,
  lists: {} as Record<string, unknown>,
  ops: [] as Array<[string, string, unknown[]]>,
}));

function from(table: string) {
  const self: Record<string, unknown> = {};
  for (const op of ["select", "eq", "order", "limit", "in"]) self[op] = (...args: unknown[]) => { mocks.ops.push([table, op, args]); return self; };
  self.update = (values: unknown) => { mocks.updates.push({ table, values }); return self; };
  self.maybeSingle = () => Promise.resolve(table === "reservations" ? { data: mocks.reservation, error: null }
    : table === "reservation_refunds" || table === "reservation_refund_current" ? { data: mocks.refundRow, error: null }
    : { data: { reservation_id: "res-1" }, error: null });
  self.then = (ok: (value: unknown) => unknown) => Promise.resolve({ data: mocks.lists[table] ?? null, error: null }).then(ok);
  return self;
}

vi.mock("@/lib/admin-api-auth", () => ({ requireAdminApiAuth: mocks.requireAdminApiAuth, getAdminContext: mocks.getAdminContext }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: () => ({ from, rpc: mocks.rpc }) }));
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { create: mocks.refundsCreate, list: mocks.refundsList },
  paymentIntents: { retrieve: mocks.retrieveIntent } }, isStripeEnabled: () => true }));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));

import { GET, PATCH, POST } from "./route";

const call = (method: "POST" | "PATCH", body: Record<string, unknown>) =>
  (method === "POST" ? POST : PATCH)(new NextRequest("http://localhost/api/payment/refund", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));

const ledger = (overrides: Record<string, unknown> = {}) => ({
  id: "rf-1", reservation_id: "res-1", kind: "deposit", amount: 200, status: "requested", created_at: new Date().toISOString(),
  deposit_gross: 200, deposit_refunded: 0, ...overrides,
});
const rpcCalls = (name: string) => mocks.rpc.mock.calls.filter(([n]) => n === name);

describe("POST /api/payment/refund — refund ledger (#444)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    mocks.reservation = { id: "res-1", payment_intent_id: "pi_1", deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger(), error: null }
      : { data: ledger({ status: "succeeded", deposit_refunded: 200 }), error: null });
    // Stripe 單位：TWD ×100
    mocks.refundsCreate.mockResolvedValue({ id: "re_1", status: "succeeded", amount: 20000, currency: "twd", payment_intent: "pi_1",
      metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } });
    mocks.refundsList.mockResolvedValue({ data: [] });
    mocks.retrieveIntent.mockResolvedValue({ id: "pi_1", latest_charge: { amount_captured: 50000, amount_refunded: 0, currency: "twd" } });
  });

  it.each([
    ["staff", { user_id: "s-1", role: "staff", branch_ids: ["b1"], legacy: false }],
    ["finance", { user_id: "f-1", role: "finance", branch_ids: null, legacy: false }],
    ["a manager of another branch", { user_id: "m-2", role: "branch_manager", branch_ids: ["b2"], legacy: false }],
    ["a manager with no branch list", { user_id: "m-3", role: "branch_manager", branch_ids: null, legacy: false }],
  ])("P2: refuses %s, using the session role even if the body claims owner", async (_who, ctx) => {
    mocks.getAdminContext.mockResolvedValue(ctx);
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消", role: "owner", p_actor_role: "owner" });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });

  it("P2/P5: records the request in the ledger with the session actor and branch list before calling Stripe", async () => {
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消", idempotencyKey: "click-1" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "request_reservation_refund", expect.objectContaining({
      p_reservation_id: "res-1", p_kind: "deposit", p_amount: null, p_method: "stripe", p_reason: "客人取消",
      p_idempotency_key: "click-1", p_actor: "mgr-1", p_actor_role: "branch_manager", p_actor_branch_ids: ["b1"],
    }));
    expect(mocks.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1", amount: 20000, metadata: expect.objectContaining({ refund_ledger_id: "rf-1" }) }),
      { idempotencyKey: "ledger_refund_rf-1" });
    // Stripe 回的 20000（TWD ×100）同步回帳本是 200 元
    expect(rpcCalls("sync_provider_refund")[0][1]).toMatchObject({ p_amount: 200, p_status: "succeeded" });
  });

  it("P1-b: caps the refund at what Stripe actually captured and has not refunded yet (in whole NT$)", async () => {
    mocks.retrieveIntent.mockResolvedValue({ id: "pi_1", latest_charge: { amount_captured: 50000, amount_refunded: 35000, currency: "twd" } });
    await call("POST", { reservationId: "res-1", reason: "客人取消" });
    expect(mocks.retrieveIntent).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] });
    expect(rpcCalls("request_reservation_refund")[0][1]).toMatchObject({ p_provider_cap: 150 });
  });

  it("P1-b: a charge Stripe cannot show is not refundable", async () => {
    mocks.retrieveIntent.mockRejectedValue(new Error("stripe down"));
    expect((await call("POST", { reservationId: "res-1", reason: "客人取消" })).status).toBe(502);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("P1-a: a retry first reconciles with Stripe and syncs the existing refund instead of creating another", async () => {
    mocks.refundsList.mockResolvedValue({ data: [{ id: "re_1", status: "pending", amount: 20000, currency: "twd", payment_intent: "pi_1",
      metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } }] });
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger(), error: null } : { data: ledger({ status: "pending" }), error: null });
    await call("POST", { reservationId: "res-1", reason: "客人取消", idempotencyKey: "click-1" });
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(rpcCalls("sync_provider_refund")[0][1]).toMatchObject({ p_provider_ref: "re_1", p_status: "pending" });
  });

  it("P1-a: never re-drives a request older than 23h; Stripe has no such refund → provider-side cancel", async () => {
    const old = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger({ created_at: old }), error: null } : { data: ledger({ status: "canceled" }), error: null });
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消", idempotencyKey: "click-old" });
    expect(response.status).toBe(200);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(rpcCalls("record_reservation_refund_status")[0][1]).toMatchObject({ p_status: "canceled", p_actor_role: "provider" });
  });

  it("P3: a partial refund sends only that amount to the ledger and Stripe", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger({ amount: 80 }), error: null }
      : { data: ledger({ amount: 80, status: "succeeded", deposit_refunded: 80 }), error: null });
    const response = await call("POST", { reservationId: "res-1", reason: "部分退", amount: 80 });
    expect(response.status).toBe(200);
    expect(rpcCalls("request_reservation_refund")[0][1]).toMatchObject({ p_amount: 80 });
    expect(mocks.refundsCreate.mock.calls[0][0]).toMatchObject({ amount: 8000 });
    // 部分退款：不把整筆付款標成已退
    expect(mocks.updates.filter((u) => u.table === "payment_intents")).toHaveLength(0);
  });

  it("P4: a pending Stripe refund is recorded as pending and nothing is marked refunded", async () => {
    mocks.refundsCreate.mockResolvedValue({ id: "re_1", status: "pending", amount: 20000, currency: "twd", payment_intent: "pi_1",
      metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } });
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger(), error: null } : { data: ledger({ status: "pending" }), error: null });
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消" });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("pending");
    expect(rpcCalls("sync_provider_refund")[0][1]).toMatchObject({ p_status: "pending", p_provider_ref: "re_1", p_ledger_refund_id: "rf-1" });
    // 不再由 API 直接寫 deposit_status／payment_intents = refunded
    expect(mocks.updates).toHaveLength(0);
  });

  it("P4: a Stripe error leaves the ledger at requested (not refunded) and does not pretend success", async () => {
    mocks.refundsCreate.mockRejectedValue(new Error("network"));
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消" });
    expect(response.status).toBe(502);
    expect(rpcCalls("sync_provider_refund")).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it("P1/P5: an idempotent replay of an already-processed refund does not call Stripe again", async () => {
    mocks.rpc.mockResolvedValue({ data: ledger({ status: "succeeded", deposit_refunded: 200 }), error: null });
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消", idempotencyKey: "click-1" });
    expect(response.status).toBe(200);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });

  it("P1: a deposit already credited or refunded is rejected by the SQL cap with a readable 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "nothing_to_refund" } });
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/沒有可以退/);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });

  it("P5: fails closed (503) when the refund ledger is not installed, without touching Stripe", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消" });
    expect(response.status).toBe(503);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it("requires a reason and a valid amount", async () => {
    expect((await call("POST", { reservationId: "res-1" })).status).toBe(400);
    expect((await call("POST", { reservationId: "res-1", reason: "x", amount: -5 })).status).toBe(400);
    expect((await call("POST", { reservationId: "res-1", reason: "x", amount: 1.5 })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records a manual (non-Stripe) refund as requested and needs a method", async () => {
    mocks.reservation = { ...mocks.reservation!, payment_intent_id: null };
    expect((await call("POST", { reservationId: "res-1", reason: "轉帳退" })).status).toBe(400);
    const response = await call("POST", { reservationId: "res-1", reason: "轉帳退", method: "transfer", amount: 200 });
    expect(response.status).toBe(200);
    expect(rpcCalls("request_reservation_refund")[0][1]).toMatchObject({ p_method: "transfer" });
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect((await response.json()).status).toBe("requested");
  });
});

describe("PATCH /api/payment/refund — manual refund outcomes need evidence (Founder D7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    mocks.reservation = { id: "res-1", payment_intent_id: null, deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.refundRow = { id: "rf-1", reservation_id: "res-1", method: "transfer", status: "requested" };
    mocks.refundsList.mockResolvedValue({ data: [] });
    mocks.rpc.mockResolvedValue({ data: ledger({ status: "succeeded" }), error: null });
  });

  it("confirms a transfer refund only with a reference and a note, recorded with the session actor", async () => {
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", note: " 已轉帳 ", reference: " TX-001 ",
      p_actor_role: "provider" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({
      p_refund_id: "rf-1", p_status: "succeeded", p_note: "已轉帳", p_evidence_ref: "TX-001", p_provider_ref: null,
      p_actor: "own-1", p_actor_role: "owner", p_actor_branch_ids: null,
    }));
  });

  it.each([
    ["no reference", { note: "已轉帳" }],
    ["a blank reference", { note: "已轉帳", reference: "   " }],
    ["no note", { reference: "TX-001" }],
    ["nothing at all", {}],
  ])("refuses to mark a transfer refund succeeded with %s (cannot clear pending without proof)", async (_what, extra) => {
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", ...extra });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/證據/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("confirms a cash refund with a note (no bank reference exists)", async () => {
    mocks.refundRow = { ...mocks.refundRow!, method: "cash" };
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded" })).status).toBe(400);
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "店長當面交給客人" })).status).toBe(200);
  });

  it.each(["failed", "canceled"])("needs a reason to mark a refund %s, then records it", async (status) => {
    expect((await call("PATCH", { refundId: "rf-1", status })).status).toBe(400);
    expect((await call("PATCH", { refundId: "rf-1", status, note: "  " })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await call("PATCH", { refundId: "rf-1", status, note: "客人改要留抵" })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({ p_status: status, p_note: "客人改要留抵" }));
  });

  it("lets a pending step be recorded without evidence (it keeps checkout blocked)", async () => {
    expect((await call("PATCH", { refundId: "rf-1", status: "pending" })).status).toBe(200);
  });

  it("rejects transitions out of a finished refund before calling SQL", async () => {
    mocks.refundRow = { ...mocks.refundRow!, status: "canceled" };
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "x", reference: "TX" })).status).toBe(409);
    mocks.refundRow = { ...mocks.refundRow!, status: "succeeded" };
    expect((await call("PATCH", { refundId: "rf-1", status: "canceled", note: "x" })).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    // 轉帳事後被退回：已退 → 失敗（要原因）
    expect((await call("PATCH", { refundId: "rf-1", status: "failed", note: "銀行退回" })).status).toBe(200);
  });

  it.each(["succeeded", "failed", "canceled"])("never lets anyone set a Stripe refund to %s by hand — only Stripe or reconcile", async (status) => {
    mocks.refundRow = { ...mocks.refundRow!, method: "stripe" };
    const response = await call("PATCH", { refundId: "rf-1", status, note: "x", reference: "re_123" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Stripe/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps the SQL re-check to a readable error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "refund_evidence_required" } });
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已轉", reference: "TX" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/證據/);
  });

  it.each([
    ["staff", { user_id: "s-1", role: "staff", branch_ids: ["b1"], legacy: false }],
    ["finance", { user_id: "f-1", role: "finance", branch_ids: null, legacy: false }],
    ["a manager of another branch", { user_id: "m-2", role: "branch_manager", branch_ids: ["b2"], legacy: false }],
  ])("refuses %s for every outcome", async (_who, ctx) => {
    mocks.getAdminContext.mockResolvedValue(ctx);
    for (const status of ["succeeded", "failed", "canceled", "pending"]) {
      expect((await call("PATCH", { refundId: "rf-1", status, note: "x", reference: "TX" })).status).toBe(403);
    }
    expect((await call("PATCH", { refundId: "rf-1", status: "requested" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("lets the branch's own manager confirm with evidence", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已轉", reference: "TX" })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({
      p_actor_role: "branch_manager", p_actor_branch_ids: ["b1"] }));
  });

  it("P1-a: reconcile asks Stripe and records Stripe's answer", async () => {
    mocks.reservation = { ...mocks.reservation!, payment_intent_id: "pi_1" };
    mocks.refundRow = { id: "rf-1", reservation_id: "res-1", kind: "deposit", amount: 200, method: "stripe", status: "requested",
      created_at: new Date().toISOString() };
    mocks.refundsList.mockResolvedValue({ data: [{ id: "re_1", status: "succeeded", amount: 20000, currency: "twd", payment_intent: "pi_1",
      metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } }] });
    const response = await call("PATCH", { refundId: "rf-1", reconcile: true });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("sync_provider_refund", expect.objectContaining({ p_status: "succeeded", p_amount: 200 }));
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });

  it("refuses reconcile from staff", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "s-1", role: "staff", branch_ids: ["b1"], legacy: false });
    mocks.refundRow = { id: "rf-1", reservation_id: "res-1", kind: "deposit", amount: 200, method: "stripe", status: "requested" };
    expect((await call("PATCH", { refundId: "rf-1", reconcile: true })).status).toBe(403);
    expect(mocks.refundsList).not.toHaveBeenCalled();
  });
});

describe("GET /api/payment/refund — refund screens", () => {
  const get = (query = "") => GET(new NextRequest(`http://localhost/api/payment/refund${query}`));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ops.length = 0;
    mocks.lists = {};
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.reservation = { id: "res-1", payment_intent_id: null, deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.rpc.mockResolvedValue({ data: { deposit_gross: 200, deposit_refunded: 0, deposit_refund_in_flight: true }, error: null });
  });
  it("refuses staff and finance", async () => {
    for (const ctx of [{ role: "staff", branch_ids: ["b1"] }, { role: "finance", branch_ids: null }]) {
      mocks.getAdminContext.mockResolvedValue({ user_id: "x", legacy: false, ...ctx });
      expect((await get()).status).toBe(403);
      expect((await get("?view=open")).status).toBe(403);
      expect((await get("?reservationId=res-1")).status).toBe(403);
    }
  });
  it("lets an owner list alerts", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    expect((await get()).status).toBe(200);
  });
  it("lists open refunds with their reservation for the manager screen", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    mocks.lists = {
      reservation_refund_current: [{ id: "rf-1", reservation_id: "res-1", status: "pending", method: "transfer", amount: 100 }],
      reservations: [{ id: "res-1", booking_code: "ABC123", customer_name: "王", start_time: "2026-10-14T06:00:00Z", status: "cancelled" }],
      reservation_refund_alerts: [],
    };
    const response = await get("?view=open");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.refunds[0]).toMatchObject({ id: "rf-1", reservation: { booking_code: "ABC123" } });
    expect(mocks.ops).toContainEqual(["reservation_refund_current", "in", ["status", ["requested", "pending"]]]);
    expect(mocks.ops.some(([table, op, args]) => table === "reservation_refund_current" && op === "in" && args[0] === "branch_id")).toBe(false);
  });
  it("scopes a branch manager's open list to their branches", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    expect((await get("?view=open")).status).toBe(200);
    expect(mocks.ops).toContainEqual(["reservation_refund_current", "in", ["branch_id", ["b1"]]]);
    expect(mocks.ops).toContainEqual(["reservation_refund_alerts", "in", ["branch_id", ["b1"]]]);
  });
  it("returns a reservation's refunds with every event, the deposit state and alerts", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    mocks.lists = {
      reservation_refund_current: [{ id: "rf-1", reservation_id: "res-1", status: "pending", method: "transfer" }],
      reservation_refund_events: [{ seq: 1, refund_id: "rf-1", status: "requested" }, { seq: 2, refund_id: "rf-1", status: "pending" }],
      reservation_refund_alerts: [],
    };
    const response = await get("?reservationId=res-1");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.events).toHaveLength(2);
    expect(json.billing).toMatchObject({ deposit_refund_in_flight: true });
    expect(json.reservation).toMatchObject({ booking_code: "ABC123", via_stripe: false });
    expect(mocks.rpc).toHaveBeenCalledWith("reservation_billing_state", { p_reservation_id: "res-1" });
  });
  it("refuses another branch's manager on a reservation", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-2", role: "branch_manager", branch_ids: ["b2"], legacy: false });
    expect((await get("?reservationId=res-1")).status).toBe(403);
  });
});
