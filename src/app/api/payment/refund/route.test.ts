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
  for (const op of ["select", "eq", "order", "limit", "in", "is"]) self[op] = (...args: unknown[]) => { mocks.ops.push([table, op, args]); return self; };
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

  it("A6-6: never re-drives a request older than 23h and never cancels it — it stays in flight with an unknown-outcome alert", async () => {
    const old = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger({ created_at: old }), error: null } : name === "raise_refund_alert" ? { data: "al-1", error: null }
      : { data: ledger({ status: "canceled" }), error: null });
    const response = await call("POST", { reservationId: "res-1", reason: "客人取消", idempotencyKey: "click-old" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "requested", needs_manual_reconcile: true });
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(rpcCalls("record_reservation_refund_status")).toHaveLength(0);
    expect(rpcCalls("raise_refund_alert")[0][1]).toMatchObject({ p_kind: "provider_outcome_unknown" });
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

describe("PATCH /api/payment/refund — manual refund outcomes need evidence (Founder D7 / A6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    mocks.reservation = { id: "res-1", payment_intent_id: null, deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.refundRow = { id: "rf-1", reservation_id: "res-1", method: "transfer", status: "requested" };
    mocks.refundsList.mockResolvedValue({ data: [] });
    mocks.rpc.mockResolvedValue({ data: ledger({ status: "succeeded" }), error: null });
  });

  it("confirms a transfer refund only with a valid reference and a note, recorded with the session actor", async () => {
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", note: " 已轉帳 ", reference: " TX20261015001 ",
      p_actor_role: "provider" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({
      p_refund_id: "rf-1", p_status: "succeeded", p_note: "已轉帳", p_evidence_ref: "TX20261015001", p_provider_ref: null,
      p_actor: "own-1", p_actor_role: "owner", p_actor_branch_ids: null, p_cash_handed_back: false,
    }));
  });

  it.each([
    ["no reference", { note: "已轉帳" }, /證據/],
    ["a blank reference", { note: "已轉帳", reference: "   " }, /證據/],
    ["no note", { reference: "TX20261015001" }, /證據/],
    ["nothing at all", {}, /證據/],
    ["free text as the reference (A6-8)", { note: "已轉帳", reference: "已經轉了" }, /格式不對/],
    ["a too-short transfer reference (A6-8)", { note: "已轉帳", reference: "TX-77" }, /格式不對/],
  ])("refuses to mark a transfer refund succeeded with %s", async (_what, extra, message) => {
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", ...extra });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["line_pay", "2026101500000000001", "12345"],
    ["card", "A1B2C3", "A1B2"],
    ["other", "JKOPAY:20261015001", "街口退款"],
  ])("validates the %s reference format", async (method, good, bad) => {
    mocks.refundRow = { ...mocks.refundRow!, method };
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已退", reference: bad })).status).toBe(400);
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已退", reference: good })).status).toBe(200);
  });

  it("completes a cash refund only after the operator confirms the cash was handed back (A6-3)", async () => {
    mocks.refundRow = { ...mocks.refundRow!, method: "cash" };
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded" })).status).toBe(400);
    const notYet = await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "店長當面交給客人" });
    expect(notYet.status).toBe(400);
    expect((await notYet.json()).error).toMatch(/交還/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "店長當面交給客人", cashHandedBack: true })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({ p_cash_handed_back: true }));
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

  it("A6-9: succeeded → failed needs evidence of the bounce (a valid reference plus a reason)", async () => {
    mocks.refundRow = { ...mocks.refundRow!, status: "succeeded" };
    const noRef = await call("PATCH", { refundId: "rf-1", status: "failed", note: "銀行退回" });
    expect(noRef.status).toBe(400);
    expect((await noRef.json()).error).toMatch(/退回或失敗的交易編號/);
    expect((await call("PATCH", { refundId: "rf-1", status: "failed", note: "銀行退回", reference: "退回了" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await call("PATCH", { refundId: "rf-1", status: "failed", note: "銀行退回", reference: "RT20261016001" })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({ p_status: "failed",
      p_evidence_ref: "RT20261016001" }));
  });

  it("A6-9: a handed-back cash refund cannot be turned into failed", async () => {
    mocks.refundRow = { ...mocks.refundRow!, method: "cash", status: "succeeded" };
    expect((await call("PATCH", { refundId: "rf-1", status: "failed", note: "弄錯", reference: "TX20261015001" })).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects transitions out of a finished refund before calling SQL", async () => {
    mocks.refundRow = { ...mocks.refundRow!, status: "canceled" };
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "x", reference: "TX20261015001" })).status).toBe(409);
    mocks.refundRow = { ...mocks.refundRow!, status: "succeeded" };
    expect((await call("PATCH", { refundId: "rf-1", status: "canceled", note: "x" })).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "failed", "canceled"])("never lets anyone set a Stripe refund to %s by hand — only Stripe or reconcile", async (status) => {
    mocks.refundRow = { ...mocks.refundRow!, method: "stripe" };
    const response = await call("PATCH", { refundId: "rf-1", status, note: "x", reference: "re_123" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Stripe/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps the SQL re-check to a readable error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "invalid_refund_reference" } });
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已轉", reference: "TX20261015001" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/格式不對/);
  });

  it.each([
    ["staff", { user_id: "s-1", role: "staff", branch_ids: ["b1"], legacy: false }],
    ["finance (read-only, A6-1)", { user_id: "f-1", role: "finance", branch_ids: null, legacy: false }],
    ["a manager of another branch", { user_id: "m-2", role: "branch_manager", branch_ids: ["b2"], legacy: false }],
  ])("refuses %s for every outcome", async (_who, ctx) => {
    mocks.getAdminContext.mockResolvedValue(ctx);
    for (const status of ["succeeded", "failed", "canceled", "pending"]) {
      expect((await call("PATCH", { refundId: "rf-1", status, note: "x", reference: "TX20261015001" })).status).toBe(403);
    }
    expect((await call("PATCH", { refundId: "rf-1", reconcile: true })).status).toBe(403);
    expect((await call("PATCH", { refundId: "rf-1", status: "requested" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("lets the branch's own manager confirm with evidence", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已轉", reference: "TX20261015001" })).status).toBe(200);
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

  it("A6-6: reconcile that cannot find the refund after 23h answers 'needs manual reconcile' and never cancels", async () => {
    mocks.reservation = { ...mocks.reservation!, payment_intent_id: "pi_1" };
    mocks.refundRow = { id: "rf-1", reservation_id: "res-1", kind: "deposit", amount: 200, method: "stripe", status: "pending",
      created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString() };
    mocks.rpc.mockImplementation(async (name: string) => name === "raise_refund_alert" ? { data: "al-9", error: null } : { data: null, error: null });
    const response = await call("PATCH", { refundId: "rf-1", reconcile: true });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending", needs_manual_reconcile: true });
    expect(rpcCalls("record_reservation_refund_status")).toHaveLength(0);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/payment/refund — alerts need an owner (A6-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ data: { acknowledged_by: "mgr-1" }, error: null });
  });
  it("lets an owner or manager take an alert with a note, passing the session identity to SQL", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    const response = await call("PATCH", { alertId: "al-1", acknowledge: true, note: " 我去 Stripe 查 ", p_actor_role: "owner" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("acknowledge_refund_alert", { p_alert_id: "al-1", p_note: "我去 Stripe 查",
      p_actor: "mgr-1", p_actor_role: "branch_manager", p_actor_branch_ids: ["b1"] });
  });
  it("needs a note", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    expect((await call("PATCH", { alertId: "al-1", acknowledge: true })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["staff", "staff"], ["finance", "finance"]])("refuses %s", async (_who, role) => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "x", role, branch_ids: null, legacy: false });
    expect((await call("PATCH", { alertId: "al-1", acknowledge: true, note: "x" })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps the SQL branch check (another branch's alert) to 403", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "m-2", role: "branch_manager", branch_ids: ["b2"], legacy: false });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "refund_not_allowed" } });
    expect((await call("PATCH", { alertId: "al-1", acknowledge: true, note: "x" })).status).toBe(403);
  });
});

describe("POST /api/payment/refund — off-system refund after manual verification (A6-2)", () => {
  const base = { reservationId: "res-1", offSystem: true, amount: 100, method: "transfer", reason: "人工核對：舊結帳沒折抵訂金",
    reference: "TX20261015123", idempotencyKey: "os-1" };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    mocks.reservation = { id: "res-1", payment_intent_id: "pi_1", deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.rpc.mockResolvedValue({ data: ledger({ status: "succeeded", amount: 100 }), error: null });
  });
  it("records it through record_offsystem_refund with the reference and session identity, without touching Stripe", async () => {
    const response = await call("POST", base);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_offsystem_refund", expect.objectContaining({ p_reservation_id: "res-1", p_amount: 100,
      p_method: "transfer", p_evidence_ref: "TX20261015123", p_cash_handed_back: false, p_idempotency_key: "os-1",
      p_actor: "mgr-1", p_actor_role: "branch_manager", p_actor_branch_ids: ["b1"] }));
    expect(mocks.retrieveIntent).not.toHaveBeenCalled();
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });
  it.each([
    ["no reason", { reason: " " }],
    ["no amount", { amount: undefined }],
    ["no idempotency key", { idempotencyKey: "" }],
    ["no reference", { reference: undefined }],
    ["free text as reference", { reference: "已轉帳" }],
    ["Stripe as the method", { method: "stripe" }],
    ["cash without the hand-back confirmation", { method: "cash", reference: undefined }],
  ])("refuses %s", async (_what, extra) => {
    expect((await call("POST", { ...base, ...extra })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("accepts cash with the hand-back confirmation", async () => {
    expect((await call("POST", { ...base, method: "cash", reference: undefined, cashHandedBack: true })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_offsystem_refund", expect.objectContaining({ p_method: "cash", p_evidence_ref: null,
      p_cash_handed_back: true }));
  });
  it.each([
    ["staff", { user_id: "s-1", role: "staff", branch_ids: ["b1"], legacy: false }],
    ["finance", { user_id: "f-1", role: "finance", branch_ids: null, legacy: false }],
    ["another branch's manager", { user_id: "m-2", role: "branch_manager", branch_ids: ["b2"], legacy: false }],
  ])("refuses %s", async (_who, ctx) => {
    mocks.getAdminContext.mockResolvedValue(ctx);
    expect((await call("POST", base)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps legacy_refund_status_unverified to a readable 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "legacy_refund_status_unverified" } });
    const response = await call("POST", base);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/盤點/);
  });
});

describe("POST /api/payment/refund — follow-up refund for a deposit difference still owed (A6-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    mocks.reservation = { id: "res-1", payment_intent_id: "pi_1", deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.rpc.mockResolvedValue({ data: ledger({ kind: "checkout_deposit_excess", amount: 100 }), error: null });
  });
  it("requests the owed difference with a manual method, never through Stripe", async () => {
    expect((await call("POST", { reservationId: "res-1", reason: "補退差額", kind: "checkout_deposit_excess" })).status).toBe(400);
    const response = await call("POST", { reservationId: "res-1", reason: "補退差額", kind: "checkout_deposit_excess", method: "transfer" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("request_reservation_refund", expect.objectContaining({ p_kind: "checkout_deposit_excess",
      p_method: "transfer", p_provider_cap: null }));
    expect(mocks.retrieveIntent).not.toHaveBeenCalled();
  });
  it("rejects unknown kinds", async () => {
    expect((await call("POST", { reservationId: "res-1", reason: "x", kind: "change", method: "cash" })).status).toBe(400);
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
  it("refuses staff", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "x", legacy: false, role: "staff", branch_ids: ["b1"] });
    expect((await get()).status).toBe(403);
    expect((await get("?view=open")).status).toBe(403);
    expect((await get("?view=ledger")).status).toBe(403);
    expect((await get("?reservationId=res-1")).status).toBe(403);
  });
  it("gives finance read-only access to the ledger, open list and a reservation (A6-1)", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "f-1", legacy: false, role: "finance", branch_ids: null });
    mocks.lists = { reservation_refund_current: [{ id: "rf-1", reservation_id: "res-1", status: "succeeded" }] };
    const ledgerRes = await get("?view=ledger");
    expect(ledgerRes.status).toBe(200);
    expect(await ledgerRes.json()).toMatchObject({ viewer: { role: "finance", can_act: false }, refunds: [{ id: "rf-1" }] });
    expect((await get("?view=open")).status).toBe(200);
    const one = await get("?reservationId=res-1");
    expect(one.status).toBe(200);
    expect((await one.json()).viewer).toEqual({ role: "finance", can_act: false });
  });
  it("tells an owner they can act", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    expect((await (await get("?reservationId=res-1")).json()).viewer).toEqual({ role: "owner", can_act: true });
  });
  it("lists only unacknowledged alerts with ?open=1", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    expect((await get("?open=1")).status).toBe(200);
    expect(mocks.ops).toContainEqual(["reservation_refund_alerts_with_ack", "is", ["acknowledged_at", null]]);
  });
  it("lists open refunds, deposit differences still owed and unacknowledged alerts for the manager screen", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    mocks.lists = {
      reservation_refund_current: [{ id: "rf-1", reservation_id: "res-1", status: "pending", method: "transfer", amount: 100 }],
      reservation_refund_obligations: [{ settlement_id: "st-1", reservation_id: "res-2", owed: 100, refunded: 0, in_flight: 0, unrequested: 100 }],
      reservations: [{ id: "res-1", booking_code: "ABC123", customer_name: "王", start_time: "2026-10-14T06:00:00Z", status: "cancelled" },
        { id: "res-2", booking_code: "XYZ999", customer_name: "林", start_time: "2026-10-14T06:00:00Z", status: "completed" }],
      reservation_refund_alerts_with_ack: [],
    };
    const response = await get("?view=open");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.refunds[0]).toMatchObject({ id: "rf-1", reservation: { booking_code: "ABC123" } });
    expect(json.obligations[0]).toMatchObject({ unrequested: 100, reservation: { booking_code: "XYZ999" } });
    expect(mocks.ops).toContainEqual(["reservation_refund_current", "in", ["status", ["requested", "pending"]]]);
    expect(mocks.ops).toContainEqual(["reservation_refund_alerts_with_ack", "is", ["acknowledged_at", null]]);
    expect(mocks.ops.some(([table, op, args]) => table === "reservation_refund_current" && op === "in" && args[0] === "branch_id")).toBe(false);
  });
  it("scopes a branch manager's open list to their branches", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    expect((await get("?view=open")).status).toBe(200);
    expect(mocks.ops).toContainEqual(["reservation_refund_current", "in", ["branch_id", ["b1"]]]);
    expect(mocks.ops).toContainEqual(["reservation_refund_obligations", "in", ["branch_id", ["b1"]]]);
    expect(mocks.ops).toContainEqual(["reservation_refund_alerts_with_ack", "in", ["branch_id", ["b1"]]]);
  });
  it("returns a reservation's refunds with every event, the deposit state, obligations and alerts", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    mocks.lists = {
      reservation_refund_current: [{ id: "rf-1", reservation_id: "res-1", status: "pending", method: "transfer" }],
      reservation_refund_events: [{ seq: 1, refund_id: "rf-1", status: "requested" }, { seq: 2, refund_id: "rf-1", status: "pending" }],
      reservation_refund_alerts_with_ack: [],
      reservation_refund_obligations: [],
    };
    const response = await get("?reservationId=res-1");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.events).toHaveLength(2);
    expect(json.billing).toMatchObject({ deposit_refund_in_flight: true });
    expect(json.reservation).toMatchObject({ booking_code: "ABC123", via_stripe: false });
    expect(json.viewer).toEqual({ role: "branch_manager", can_act: true });
    expect(mocks.rpc).toHaveBeenCalledWith("reservation_billing_state", { p_reservation_id: "res-1" });
  });
  it("refuses another branch's manager on a reservation", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-2", role: "branch_manager", branch_ids: ["b2"], legacy: false });
    expect((await get("?reservationId=res-1")).status).toBe(403);
  });
});
