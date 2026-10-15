import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markDepositPaid,
  verifyStripeIntentForReservation,
  markDepositUnpaid,
  updateDepositInfo,
  type DepositEffects,
  type DepositSource,
} from "./deposit-paid";

/** In-memory adapter at the DepositEffects seam. */
function world(over: Partial<Record<string, unknown>> = {}, notify?: DepositEffects["notify"]) {
  const row = {
    is_deposit_paid: false, deposit_payment_note: null as string | null, deposit_paid_on: null as string | null,
    deposit_last_five: null as string | null, status: "confirmed", booking_code: "ABC123", ...over,
  };
  const writes: Record<string, unknown>[] = [];
  const audits: Parameters<DepositEffects["audit"]>[0][] = [];
  const notifications: { id: string; opts: unknown }[] = [];
  const fx: DepositEffects = {
    load: async (id) => (id === "r1" ? { ...row } : null),
    write: async (_id, patch) => { writes.push(patch); Object.assign(row, patch); },
    notify: notify ?? (async (id, opts) => { notifications.push({ id, opts }); return { ok: true, accepted_by_platform: true }; }),
    audit: (e) => { audits.push(e); },
  };
  return { row, writes, audits, notifications, fx };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("markDepositPaid: every source writes, audits and notifies", () => {
  it.each<[DepositSource, string]>([
    ["admin_patch", "admin_session"],
    ["payment_review", "admin_payment_review"],
    ["stripe_webhook", "stripe_webhook"],
    ["stripe_confirm", "stripe_confirm"],
  ])("%s", async (source, auditActor) => {
    const w = world();
    const r = await markDepositPaid("r1", source, {}, null, w.fx);
    expect(r).toMatchObject({ changed: true, notification: { ok: true } });
    expect(w.row.is_deposit_paid).toBe(true);
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ action: "deposit.marked_paid", actor_type: auditActor, booking_code: "ABC123" });
    expect(w.notifications).toHaveLength(1);
  });

  it("only Stripe sources write deposit_status", async () => {
    const a = world(); await markDepositPaid("r1", "admin_patch", {}, null, a.fx);
    const b = world(); await markDepositPaid("r1", "stripe_webhook", {}, null, b.fx);
    expect(a.writes[0]).not.toHaveProperty("deposit_status");
    expect(b.writes[0]).toMatchObject({ deposit_status: "paid" });
  });

  it("only manual admin approval bypasses the payment-review history check", async () => {
    const a = world(); await markDepositPaid("r1", "admin_patch", {}, "u1", a.fx);
    const b = world(); await markDepositPaid("r1", "payment_review", { paymentEventId: "e1" }, "u1", b.fx);
    expect(a.notifications[0].opts).toMatchObject({ manualApproval: true, actor: "u1" });
    expect(b.notifications[0].opts).toMatchObject({ manualApproval: false, paymentEventId: "e1" });
  });

  it("evidence is stored and shown in the notification", async () => {
    const w = world();
    await markDepositPaid("r1", "admin_patch", { note: "匯款", paidOn: "2026-10-01", lastFive: "12345" }, null, w.fx);
    expect(w.row).toMatchObject({ deposit_payment_note: "匯款", deposit_paid_on: "2026-10-01", deposit_last_five: "12345" });
    expect(w.notifications[0].opts).toMatchObject({ reviewNote: "匯款" });
    expect(w.audits[0].after).toMatchObject({ is_deposit_paid: true, deposit_payment_note: "匯款" });
  });

  it("an explicit reviewNote is what the notification shows, the stored note is separate", async () => {
    const w = world();
    await markDepositPaid("r1", "payment_review", { note: "付款截圖", reviewNote: null }, null, w.fx);
    expect(w.row.deposit_payment_note).toBe("付款截圖");
    expect(w.notifications[0].opts).toMatchObject({ reviewNote: null });
  });

  it("already paid: no second audit entry, but the notification is retried", async () => {
    const w = world({ is_deposit_paid: true });
    const r = await markDepositPaid("r1", "admin_patch", {}, null, w.fx);
    expect(r.changed).toBe(false);
    expect(w.audits).toEqual([]);
    expect(w.notifications).toHaveLength(1);
  });

  it("a notification that throws is reported, never raised: the payment stays recorded", async () => {
    const w = world({}, async () => { throw new Error("provider unavailable"); });
    const r = await markDepositPaid("r1", "stripe_webhook", {}, null, w.fx);
    expect(r.notification).toEqual({ ok: false, error: "notification_dispatch_failed" });
    expect(w.row.is_deposit_paid).toBe(true);
  });

  it("unknown reservation", async () => {
    await expect(markDepositPaid("nope", "admin_patch", {}, null, world().fx)).rejects.toThrow("找不到訂位");
  });
});

describe("unpaid and info edits", () => {
  it("markDepositUnpaid audits the reversal and sends nothing", async () => {
    const w = world({ is_deposit_paid: true });
    expect(await markDepositUnpaid("r1", {}, w.fx)).toEqual({ changed: true });
    expect(w.audits[0]).toMatchObject({ action: "deposit.marked_unpaid" });
    expect(w.notifications).toEqual([]);
  });
  it("updateDepositInfo audits only real changes", async () => {
    const w = world({ deposit_last_five: "11111" });
    await updateDepositInfo("r1", { lastFive: "11111" }, w.fx);
    expect(w.audits).toEqual([]);
    await updateDepositInfo("r1", { lastFive: "22222" }, w.fx);
    expect(w.audits[0]).toMatchObject({ action: "deposit.note_updated" });
  });
});

describe("verifyStripeIntentForReservation (binding + amount)", () => {
  const fx = (boundTo: string | null, total: number | null) => ({
    intentReservationId: async () => boundTo,
    totalPrice: async () => total,
  });
  // Stripe 單位：NT$500 = 50000
  const pi = (over = {}) => ({ id: "pi_1", amount: 50000, currency: "twd", metadata: { reservationId: "r1" }, ...over });
  const check = (p: ReturnType<typeof pi>, f = fx("r1", 1000)) => verifyStripeIntentForReservation(p, "r1", f);

  it("correct, sufficient intent is accepted", async () => {
    expect(await check(pi())).toEqual({ ok: true });
  });
  it("intent created for another reservation is refused (metadata)", async () => {
    expect(await check(pi({ metadata: { reservationId: "other" } }))).toMatchObject({ ok: false, status: 403 });
  });
  it("intent recorded against another reservation is refused (payment_intents row)", async () => {
    expect(await check(pi(), fx("other", 1000))).toMatchObject({ ok: false, status: 403 });
  });
  it("intent without metadata is refused", async () => {
    expect(await check(pi({ metadata: {} }))).toMatchObject({ ok: false, status: 403 });
  });
  it("underpaid and wrong-currency intents are refused", async () => {
    expect(await check(pi({ amount: 10000 }))).toMatchObject({ ok: false, status: 409 });
    // 舊的單位錯誤：把 500 元當成 Stripe amount 500（= NT$5）送出，不能算付清
    expect(await check(pi({ amount: 500 }))).toMatchObject({ ok: false, status: 409 });
    expect(await check(pi({ currency: "usd" }))).toMatchObject({ ok: false, status: 409 });
  });
});
