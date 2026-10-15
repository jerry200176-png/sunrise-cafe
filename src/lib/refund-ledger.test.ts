import { describe, expect, it, vi } from "vitest";
import { capturedRemaining, driveStripeRefund, stripeRefundIdempotencyKey, syncStripeRefund, STRIPE_REDRIVE_WINDOW_MS,
  STRIPE_REFUND_LIST_MAX_PAGES } from "@/lib/refund-ledger";

const db = (rpc = vi.fn(async (name: string, args: Record<string, unknown>) => (name === "raise_refund_alert"
  ? { data: "alert-1", error: null }
  : { data: { id: "rf-1", status: args.p_status, amount: args.p_amount ?? 200, deposit_gross: 200, deposit_refunded: 0 }, error: null })),
knownRefs: string[] = []) => ({ rpc, from: () => ({ select: () => ({ eq: () => ({
  maybeSingle: async () => ({ data: null }),
  then: (ok: (value: unknown) => unknown) => Promise.resolve({ data: knownRefs.map((provider_ref) => ({ provider_ref })), error: null }).then(ok),
}) }) }) }) as never;

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

  it("A6-6: past 23h and not found → never cancels or unlocks; raises an unknown-outcome alert instead", async () => {
    const rpc = vi.fn(async (name: string) => (name === "raise_refund_alert" ? { data: "alert-1", error: null } : { data: null, error: null }));
    const refunds = { list: vi.fn(async () => ({ data: [] })), create: vi.fn() };
    const out = await driveStripeRefund(db(rpc as never), refunds, ledger(STRIPE_REDRIVE_WINDOW_MS + 60_000), "pi_1", { reservationId: "res-1" });
    expect(refunds.create).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("record_reservation_refund_status", expect.anything());
    expect(rpc).toHaveBeenCalledWith("raise_refund_alert", expect.objectContaining({ p_refund_id: "rf-1", p_kind: "provider_outcome_unknown",
      p_detail: expect.objectContaining({ reason: "not_found_after_redrive_window" }) }));
    expect(out).toEqual({ unknown: true, reason: "not_found_after_redrive_window", alertId: "alert-1" });
  });

  it("A6-6: pages through every Stripe refund on the payment intent before deciding", async () => {
    const page = (ids: string[], hasMore: boolean) => ({ data: ids.map((id) => ({ id, status: "succeeded", amount: 100, metadata: {} })), has_more: hasMore });
    const list = vi.fn()
      .mockResolvedValueOnce(page(["re_a", "re_b"], true))
      .mockResolvedValueOnce({ data: [{ id: "re_c", status: "succeeded", amount: 20000, currency: "twd",
        metadata: { refund_ledger_id: "rf-1", reservationId: "res-1" } }], has_more: false });
    const refunds = { list, create: vi.fn() };
    const out = await driveStripeRefund(db(), refunds, ledger(STRIPE_REDRIVE_WINDOW_MS + 60_000), "pi_1", { reservationId: "res-1" });
    expect(list).toHaveBeenNthCalledWith(2, { payment_intent: "pi_1", limit: 100, starting_after: "re_b" });
    expect(out).toMatchObject({ status: "succeeded" });
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it("A6-6: looks up refund ids already on the ledger directly, even when the list does not show them", async () => {
    const rpc = vi.fn(async (_n: string, args: Record<string, unknown>) => ({ data: { id: "rf-1", status: args.p_status }, error: null }));
    const retrieve = vi.fn(async () => ({ id: "re_known", status: "succeeded", amount: 20000, currency: "twd",
      metadata: { reservationId: "res-1", refund_ledger_id: "rf-1" } }));
    const refunds = { list: vi.fn(async () => ({ data: [], has_more: false })), retrieve, create: vi.fn() };
    const out = await driveStripeRefund(db(rpc as never, ["re_known"]), refunds, ledger(0), "pi_1", { reservationId: "res-1" });
    expect(retrieve).toHaveBeenCalledWith("re_known");
    expect(rpc).toHaveBeenCalledWith("sync_provider_refund", expect.objectContaining({ p_provider_ref: "re_known", p_status: "succeeded" }));
    expect(refunds.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "succeeded" });
  });

  it("A6-6: an incomplete listing is unknown, not 'no refund' — no re-drive, no cancel, an alert", async () => {
    const rpc = vi.fn(async (name: string) => (name === "raise_refund_alert" ? { data: "alert-2", error: null } : { data: null, error: null }));
    const list = vi.fn(async (params: { starting_after?: string }) => ({ data: [{ id: `re_${params.starting_after ?? "0"}x`, metadata: {}, amount: 1 }], has_more: true }));
    const refunds = { list, create: vi.fn() };
    const out = await driveStripeRefund(db(rpc as never), refunds, ledger(0), "pi_1", { reservationId: "res-1" });
    expect(list).toHaveBeenCalledTimes(STRIPE_REFUND_LIST_MAX_PAGES);
    expect(refunds.create).not.toHaveBeenCalled();
    expect(out).toEqual({ unknown: true, reason: "stripe_refund_list_incomplete", alertId: "alert-2" });
  });

  it("P2: a refund pointing at another reservation is not swallowed — it writes an alert and throws", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "refund_reservation_mismatch" } }));
    const client = { rpc, from: (table: string) => (table === "reservation_refund_alerts" ? { insert } : {}) } as never;
    await expect(syncStripeRefund(client, { id: "re_x", status: "succeeded", amount: 20000, payment_intent: "pi_1",
      metadata: { reservationId: "res-1", refund_ledger_id: "rf-other" } })).rejects.toMatchObject({ message: "refund_reservation_mismatch" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ reservation_id: "res-1", kind: "provider_reservation_mismatch",
      detail: expect.objectContaining({ provider_ref: "re_x", ledger_refund_id: "rf-other" }) }));
  });
});
