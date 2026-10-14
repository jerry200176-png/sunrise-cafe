import { describe, expect, it, vi } from "vitest";
import { capturedRemaining, driveStripeRefund, stripeRefundIdempotencyKey, syncStripeRefund, STRIPE_REDRIVE_WINDOW_MS } from "@/lib/refund-ledger";

const db = (rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
  data: { id: "rf-1", status: args.p_status, amount: args.p_amount ?? 200, deposit_gross: 200, deposit_refunded: 0 }, error: null,
}))) => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) as never;

const ledger = (createdAgoMs: number) => ({ id: "rf-1", reservation_id: "res-1", kind: "deposit", amount: 200, status: "requested",
  created_at: new Date(Date.now() - createdAgoMs).toISOString(), deposit_gross: 200, deposit_refunded: 0 });

describe("refund-ledger (Stripe boundary)", () => {
  it("P1-b: converts Stripe TWD amounts (×100) back to whole NT$ when syncing", async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    await syncStripeRefund(db(rpc as never), { id: "re_1", status: "succeeded", amount: 15000, currency: "twd",
      metadata: { reservationId: "res-1", refund_ledger_id: "rf-1" } });
    expect(rpc).toHaveBeenCalledWith("sync_provider_refund", expect.objectContaining({ p_amount: 150 }));
  });

  it("P1-b: refundable = captured − already refunded on the Stripe charge, in NT$", () => {
    expect(capturedRemaining({ amount_captured: 50000, amount_refunded: 20000, currency: "twd" })).toBe(300);
    expect(capturedRemaining({ amount_captured: 50000, amount_refunded: 50000 })).toBe(0);
    expect(capturedRemaining(null)).toBe(0);
  });

  it("P2: the Stripe idempotency key contains the ledger row id", () => {
    expect(stripeRefundIdempotencyKey("rf-123")).toBe("ledger_refund_rf-123");
  });

  it("P2: stale transitions are reported as ignored instead of thrown", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "invalid_refund_transition" } }));
    expect(await syncStripeRefund(db(rpc as never), { id: "re_1", status: "pending", amount: 100,
      metadata: { reservationId: "res-1" } })).toEqual({ ignored: "invalid_refund_transition" });
  });

  it("P1-a: reconciles first — an existing Stripe refund for this ledger row is synced, never re-created", async () => {
    const refunds = { list: vi.fn(async () => ({ data: [{ id: "re_9", status: "succeeded", amount: 20000, currency: "twd",
      metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } }] })), create: vi.fn() };
    const out = await driveStripeRefund(db(), refunds, ledger(0), "pi_1", { reservationId: "res-1" });
    expect(refunds.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "succeeded" });
  });

  it("P1-a: within 23h and not found → creates with the ledger idempotency key and the amount ×100", async () => {
    const refunds = { list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async () => ({ id: "re_1", status: "pending", amount: 20000, currency: "twd",
        metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } })) };
    await driveStripeRefund(db(), refunds, ledger(STRIPE_REDRIVE_WINDOW_MS - 60_000), "pi_1", { reservationId: "res-1" });
    expect(refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 20000 }), { idempotencyKey: "ledger_refund_rf-1" });
  });

  it("P1-a: past 23h and not found → does not re-drive; records a provider-side cancel", async () => {
    const rpc = vi.fn(async (_n: string, args: Record<string, unknown>) => ({ data: { id: "rf-1", status: args.p_status }, error: null }));
    const refunds = { list: vi.fn(async () => ({ data: [] })), create: vi.fn() };
    const out = await driveStripeRefund(db(rpc as never), refunds, ledger(STRIPE_REDRIVE_WINDOW_MS + 60_000), "pi_1", { reservationId: "res-1" });
    expect(refunds.create).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_reservation_refund_status", expect.objectContaining({ p_status: "canceled", p_actor_role: "provider" }));
    expect(out).toMatchObject({ status: "canceled" });
  });
});
