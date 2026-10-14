import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminApiAuth: vi.fn(),
  getAdminContext: vi.fn(),
  rpc: vi.fn(),
  refundsCreate: vi.fn(),
  logOps: vi.fn(),
  updates: [] as Array<{ table: string; values: unknown }>,
  reservation: null as Record<string, unknown> | null,
  refundRow: null as Record<string, unknown> | null,
}));

function from(table: string) {
  const self: Record<string, unknown> = {};
  for (const op of ["select", "eq"]) self[op] = () => self;
  self.update = (values: unknown) => { mocks.updates.push({ table, values }); return self; };
  self.maybeSingle = () => Promise.resolve(table === "reservations" ? { data: mocks.reservation, error: null }
    : table === "reservation_refunds" ? { data: mocks.refundRow, error: null }
    : { data: { reservation_id: "res-1" }, error: null });
  self.then = (ok: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return self;
}

vi.mock("@/lib/admin-api-auth", () => ({ requireAdminApiAuth: mocks.requireAdminApiAuth, getAdminContext: mocks.getAdminContext }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: () => ({ from, rpc: mocks.rpc }) }));
vi.mock("@/lib/stripe", () => ({ stripe: { refunds: { create: mocks.refundsCreate } }, isStripeEnabled: () => true }));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));

import { PATCH, POST } from "./route";

const call = (method: "POST" | "PATCH", body: Record<string, unknown>) =>
  (method === "POST" ? POST : PATCH)(new NextRequest("http://localhost/api/payment/refund", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));

const ledger = (overrides: Record<string, unknown> = {}) => ({
  id: "rf-1", reservation_id: "res-1", kind: "deposit", amount: 200, status: "requested",
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
    mocks.refundsCreate.mockResolvedValue({ id: "re_1", status: "succeeded", amount: 200, payment_intent: "pi_1",
      metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } });
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
      expect.objectContaining({ payment_intent: "pi_1", amount: 200, metadata: expect.objectContaining({ refund_ledger_id: "rf-1" }) }),
      { idempotencyKey: "ledger_refund_rf-1" });
  });

  it("P3: a partial refund sends only that amount to the ledger and Stripe", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "request_reservation_refund"
      ? { data: ledger({ amount: 80 }), error: null }
      : { data: ledger({ amount: 80, status: "succeeded", deposit_refunded: 80 }), error: null });
    const response = await call("POST", { reservationId: "res-1", reason: "部分退", amount: 80 });
    expect(response.status).toBe(200);
    expect(rpcCalls("request_reservation_refund")[0][1]).toMatchObject({ p_amount: 80 });
    expect(mocks.refundsCreate.mock.calls[0][0]).toMatchObject({ amount: 80 });
    // 部分退款：不把整筆付款標成已退
    expect(mocks.updates.filter((u) => u.table === "payment_intents")).toHaveLength(0);
  });

  it("P4: a pending Stripe refund is recorded as pending and nothing is marked refunded", async () => {
    mocks.refundsCreate.mockResolvedValue({ id: "re_1", status: "pending", amount: 200, payment_intent: "pi_1",
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

describe("PATCH /api/payment/refund — confirm a manual refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "own-1", role: "owner", branch_ids: null, legacy: false });
    mocks.reservation = { id: "res-1", payment_intent_id: null, deposit_status: "paid", booking_code: "ABC123", room: { branch_id: "b1" } };
    mocks.refundRow = { id: "rf-1", reservation_id: "res-1" };
    mocks.rpc.mockResolvedValue({ data: ledger({ status: "succeeded" }), error: null });
  });

  it("appends the new status with the session actor", async () => {
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded", note: "已轉帳" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({
      p_refund_id: "rf-1", p_status: "succeeded", p_note: "已轉帳", p_actor_role: "owner", p_actor_branch_ids: null,
    }));
  });

  it("refuses staff and rejects unknown statuses", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "s-1", role: "staff", branch_ids: ["b1"], legacy: false });
    expect((await call("PATCH", { refundId: "rf-1", status: "succeeded" })).status).toBe(403);
    expect((await call("PATCH", { refundId: "rf-1", status: "requested" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps provider_outcome_only (staff trying to mark a Stripe refund succeeded) to 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "provider_outcome_only" } });
    const response = await call("PATCH", { refundId: "rf-1", status: "succeeded" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Stripe/);
  });
});
