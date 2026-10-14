import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  event: null as unknown,
  rpc: vi.fn(),
  refundsList: vi.fn(),
  updates: [] as Array<{ table: string; values: unknown }>,
}));

function from(table: string) {
  const self: Record<string, unknown> = {};
  for (const op of ["select", "eq"]) self[op] = () => self;
  self.update = (values: unknown) => { mocks.updates.push({ table, values }); return self; };
  self.maybeSingle = () => Promise.resolve({ data: { reservation_id: "res-1" }, error: null });
  self.single = self.maybeSingle;
  self.then = (ok: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return self;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: () => ({ from, rpc: mocks.rpc }) }));
vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: () => mocks.event }, refunds: { list: mocks.refundsList } },
  isStripeEnabled: () => true,
}));
vi.mock("@/lib/deposit-paid", () => ({ markDepositPaid: vi.fn(), verifyStripeIntentForReservation: vi.fn() }));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));

import { POST } from "./route";

const send = () => POST(new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}",
  headers: { "stripe-signature": "sig" } }));
// Stripe 單位：TWD ×100（NT$200 = 20000）
const refund = (status: string, amount = 200) => ({ id: "re_1", status, amount: amount * 100, currency: "twd", payment_intent: "pi_1",
  metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } });
const deposit = (refunded: number, status: string) => ({ data: { id: "rf-1", reservation_id: "res-1", kind: "deposit",
  amount: 200, status, deposit_gross: 200, deposit_refunded: refunded }, error: null });

describe("Stripe webhook → refund ledger (#444)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
  });

  it("P4: a pending refund is synced as pending and never marks the deposit refunded", async () => {
    mocks.event = { type: "refund.updated", data: { object: refund("pending") } };
    mocks.rpc.mockResolvedValue(deposit(0, "pending"));
    expect((await send()).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("sync_provider_refund", expect.objectContaining({
      p_reservation_id: "res-1", p_ledger_refund_id: "rf-1", p_provider_ref: "re_1", p_status: "pending", p_amount: 200,
    }));
    expect(mocks.updates).toHaveLength(0);
  });

  it("P4: a failed refund is synced as failed", async () => {
    mocks.event = { type: "refund.failed", data: { object: refund("failed") } };
    mocks.rpc.mockResolvedValue(deposit(0, "failed"));
    await send();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_status: "failed" });
    expect(mocks.updates).toHaveLength(0);
  });

  it("P3: charge.refunded syncs every refund and only a full succeeded refund marks the payment refunded", async () => {
    mocks.event = { type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 200, amount_refunded: 80 } } };
    mocks.refundsList.mockResolvedValue({ data: [refund("succeeded", 80)] });
    mocks.rpc.mockResolvedValue(deposit(80, "succeeded"));
    await send();
    expect(mocks.refundsList).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 });
    expect(mocks.updates).toHaveLength(0);

    mocks.rpc.mockResolvedValue(deposit(200, "succeeded"));
    await send();
    expect(mocks.updates).toEqual([{ table: "payment_intents", values: expect.objectContaining({ status: "refunded" }) }]);
  });

  it("before the migration: falls back to deposit_status=refunded only when the whole charge was refunded", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    mocks.refundsList.mockResolvedValue({ data: [refund("succeeded", 80)] });
    mocks.event = { type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 200, amount_refunded: 80 } } };
    await send();
    expect(mocks.updates).toHaveLength(0);
    mocks.event = { type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 200, amount_refunded: 200 } } };
    await send();
    expect(mocks.updates.map((u) => u.table).sort()).toEqual(["payment_intents", "reservations"]);
  });

  it("P2: a stale or out-of-order transition is logged and acknowledged with 200, not a 500", async () => {
    mocks.event = { type: "refund.updated", data: { object: refund("pending") } };
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "invalid_refund_transition" } });
    expect((await send()).status).toBe(200);
    expect(mocks.updates).toHaveLength(0);
  });

  it("P2: an unexpected database error still fails the webhook so Stripe retries", async () => {
    mocks.event = { type: "refund.updated", data: { object: refund("succeeded") } };
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await send()).status).toBe(500);
  });
});
