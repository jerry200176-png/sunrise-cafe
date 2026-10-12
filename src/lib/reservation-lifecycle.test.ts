import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  guestAllowedActions,
  intentForStatusChange,
  transitionReservation,
  type Actor,
  type Effects,
  type Intent,
  type Snapshot,
} from "./reservation-lifecycle";

const H = 3_600_000;
const admin: Actor = { kind: "admin", userId: "u1" };
const guest: Actor = { kind: "guest" };

/** In-memory adapter at the Effects seam; records what happened. */
function world(
  over: Partial<Snapshot> = {},
  bookable: { ok: true } | { ok: false; reason: "conflict" } = { ok: true },
  opts: { casLost?: boolean; holdFails?: boolean } = {}
) {
  const row: Snapshot = {
    id: "r1", status: "pending", room_id: "room", booking_code: "ABC123",
    start_time: new Date(Date.now() + 72 * H).toISOString(),
    end_time: new Date(Date.now() + 74 * H).toISOString(),
    guest_count: 4, is_deposit_paid: false, customer_name: "王", phone: "09",
    line_user_id: "U1", review_invited_at: null, branch_name: "大安", ...over,
  };
  const calls: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const fx: Effects = {
    load: async (id) => (id === row.id ? { ...row } : null),
    update: async (_id, patch) => { calls.push("update"); Object.assign(row, patch); },
    setStatusIf: async (_id, from, to) => {
      calls.push(`cas:${from}>${to}`);
      if (opts.casLost || row.status !== from) return false;
      row.status = to;
      return true;
    },
    holdDepositRelease: async () => {
      calls.push("holdDepositRelease");
      if (opts.holdFails) throw new Error("ledger down");
    },
    cancelPreorder: async (_i, reason) => { calls.push(`cancelPreorder:${reason}`); },
    lockPreorder: async () => { calls.push("lockPreorder"); },
    requirePreorderReconfirmation: async (_i, reason) => { calls.push(`reconfirm:${reason}`); },
    resetReminders: async () => { calls.push("resetReminders"); },
    notifyWaitlist: async () => { calls.push("waitlist"); },
    guestCancelled: async () => { calls.push("guestCancelledCard"); },
    guestRescheduled: async () => { calls.push("guestRescheduledCard"); },
    groupRescheduled: async () => { calls.push("groupRescheduledCard"); },
    requestDeposit: async () => { calls.push("requestDeposit"); return "sent"; },
    sendReviewInvite: async () => { calls.push("reviewInvite"); },
    checkBookable: (async () => bookable) as Effects["checkBookable"],
    audit: (e) => { audits.push(e); },
  };
  return { row, calls, audits, fx };
}
const run = (w: ReturnType<typeof world>, intent: Intent, actor: Actor) =>
  transitionReservation("r1", intent, actor, w.fx);

describe("admin transition table", () => {
  const T = (type: Intent["type"]) => ({ type }) as Intent;
  it.each([
    ["pending", "confirm", "confirmed"],
    ["pending", "cancel", "cancelled"],
    ["pending", "check_in", "checked_in"],
    ["confirmed", "complete", "completed"],
    ["confirmed", "cancel", "cancelled"],
    ["checked_in", "complete", "completed"],
    ["cancelled", "restore", "pending"],
  ])("%s + %s -> %s", async (from, type, to) => {
    const w = world({ status: from });
    const r = await run(w, T(type as Intent["type"]), admin);
    expect(r).toMatchObject({ ok: true, status: to });
    expect(w.row.status).toBe(to);
    expect(w.audits[0]).toMatchObject({ intent: type, from, to, actor: "admin", actor_id: "u1" });
  });

  it.each([
    ["completed", "cancel"], ["completed", "confirm"], ["cancelled", "confirm"],
    ["cancelled", "complete"], ["confirmed", "confirm"], ["pending", "restore"], ["checked_in", "confirm"],
  ])("%s + %s is refused and writes nothing", async (from, type) => {
    const w = world({ status: from });
    const r = await run(w, T(type as Intent["type"]), admin);
    expect(r).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(w.calls).toEqual([]);
  });

  it("tells staff to use 還原 for a cancelled booking", async () => {
    const r = await run(world({ status: "cancelled" }), { type: "confirm" }, admin);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("還原") });
  });

  it("unknown reservation", async () => {
    expect(await transitionReservation("nope", { type: "cancel" }, admin, world().fx)).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("side effects per intent", () => {
  it("cancel: preorder, guest card, waitlist", async () => {
    const w = world({ status: "confirmed" });
    await run(w, { type: "cancel" }, admin);
    expect(w.calls).toEqual(["update", "cancelPreorder:admin_cancel_or_reject", "guestCancelledCard", "waitlist"]);
  });
  it("cancel without LINE binding sends no card", async () => {
    const w = world({ line_user_id: null });
    await run(w, { type: "cancel" }, admin);
    expect(w.calls).not.toContain("guestCancelledCard");
  });
  it("deposit-deadline cancel leaves the release cards to the job", async () => {
    const w = world();
    await run(w, { type: "cancel", reason: "deposit_deadline" }, { kind: "system", job: "deposit_deadline" });
    expect(w.calls).toEqual(["update", "cancelPreorder:deposit_deadline_auto_cancel", "waitlist"]);
  });
  it("a failing card does not undo the cancellation", async () => {
    const w = world();
    w.fx.guestCancelled = async () => { throw new Error("line down"); };
    expect(await run(w, { type: "cancel" }, admin)).toMatchObject({ ok: true });
    expect(w.calls).toContain("waitlist");
  });
  it("confirm asks the guest for the deposit and reports the LINE result", async () => {
    const w = world();
    expect(await run(w, { type: "confirm" }, admin)).toMatchObject({ ok: true, lineResult: "sent" });
  });
  it("complete locks the preorder and invites a review once", async () => {
    const w = world({ status: "checked_in" });
    await run(w, { type: "complete" }, admin);
    expect(w.calls).toEqual(["update", "lockPreorder", "reviewInvite"]);
    const again = world({ status: "checked_in", review_invited_at: "2026-01-01" });
    await run(again, { type: "complete" }, admin);
    expect(again.calls).not.toContain("reviewInvite");
  });
});

describe("no_show (沒來)", () => {
  const past = { start_time: new Date(Date.now() - 3 * H).toISOString(), end_time: new Date(Date.now() - 1 * H).toISOString() };
  it.each(["pending", "confirmed"])("%s after the start time -> no_show, audited", async (from) => {
    const w = world({ status: from, ...past });
    expect(await run(w, { type: "no_show" }, admin)).toMatchObject({ ok: true, status: "no_show" });
    expect(w.audits[0]).toMatchObject({ intent: "no_show", from, to: "no_show" });
  });
  it("is refused before the booking time and writes nothing", async () => {
    const w = world({ status: "confirmed" });
    expect(await run(w, { type: "no_show" }, admin)).toMatchObject({ ok: false, httpStatus: 409 });
    expect(w.calls).toEqual([]);
  });
  it.each(["checked_in", "completed", "cancelled"])("%s cannot become no_show", async (from) => {
    const w = world({ status: from, ...past });
    expect(await run(w, { type: "no_show" }, admin)).toMatchObject({ ok: false, code: "invalid_transition" });
  });
  it("can be restored when marked by mistake; guests cannot mark it", async () => {
    const w = world({ status: "no_show", ...past });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(await run(world({ status: "confirmed", ...past }), { type: "no_show" }, guest)).toMatchObject({ ok: false });
  });
  it("PATCH status=no_show maps to the intent", () => {
    expect(intentForStatusChange("confirmed", "no_show")).toEqual({ intent: { type: "no_show" } });
  });
});

describe("restore (還原)", () => {
  it("returns to confirmed when the deposit is already paid", async () => {
    const w = world({ status: "cancelled", is_deposit_paid: true });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "confirmed" });
  });
  it("is refused when the slot was taken meanwhile", async () => {
    const w = world({ status: "cancelled" }, { ok: false, reason: "conflict" });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: false, code: "not_bookable", httpStatus: 409 });
    expect(w.row.status).toBe("cancelled");
  });
});

describe("restore after deposit release (#437)", () => {
  const longAgo = new Date(Date.now() - 10 * 24 * H).toISOString();
  const pastSlot = { start_time: new Date(Date.now() - 2 * H).toISOString(), end_time: new Date(Date.now() + 1 * H).toISOString() };

  it("unpaid + deadline already passed: restored to pending with a cron hold, payment untouched", async () => {
    const w = world({ status: "cancelled", created_at: longAgo, ...pastSlot });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(w.calls).toContain("holdDepositRelease");
    expect(w.row.is_deposit_paid).toBe(false);
    expect(w.audits[0]).toMatchObject({ intent: "restore", from: "cancelled", to: "pending" });
  });
  it("unpaid but deadline still ahead: no hold needed", async () => {
    const w = world({ status: "cancelled", created_at: new Date().toISOString() });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(w.calls).not.toContain("holdDepositRelease");
  });
  it("paid: back to confirmed, no hold", async () => {
    const w = world({ status: "cancelled", is_deposit_paid: true, created_at: longAgo, ...pastSlot });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "confirmed" });
    expect(w.calls).not.toContain("holdDepositRelease");
  });
  it("no_show restored with the same rules", async () => {
    const w = world({ status: "no_show", created_at: longAgo, ...pastSlot });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(w.calls).toContain("holdDepositRelease");
  });
  it("concurrent restore loses the compare-and-set: refused, no hold, no audit", async () => {
    const w = world({ status: "cancelled", created_at: longAgo }, { ok: true }, { casLost: true });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(w.calls).not.toContain("holdDepositRelease");
    expect(w.audits).toEqual([]);
  });
  it("slot taken: refused before any write", async () => {
    const w = world({ status: "cancelled", created_at: longAgo }, { ok: false, reason: "conflict" });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: false, code: "not_bookable" });
    expect(w.calls).toEqual([]);
  });
  it("hold failure reverts the status instead of leaving a booking the cron will cancel", async () => {
    const w = world({ status: "cancelled", created_at: longAgo, ...pastSlot }, { ok: true }, { holdFails: true });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: false, code: "restore_hold_failed" });
    expect(w.row.status).toBe("cancelled");
    expect(w.audits).toEqual([]);
  });
  it("never resumes a cancelled preorder", async () => {
    const w = world({ status: "cancelled", created_at: longAgo });
    await run(w, { type: "restore" }, admin);
    expect(w.calls.filter((c) => /Preorder|reconfirm/.test(c))).toEqual([]);
  });
});

describe("guest cancel policy", () => {
  it("unpaid, more than 24h ahead: allowed", async () => {
    expect(await run(world(), { type: "cancel" }, guest)).toMatchObject({ ok: true });
  });
  it("inside 24h: blocked", async () => {
    const w = world({ start_time: new Date(Date.now() + 10 * H).toISOString() });
    expect(await run(w, { type: "cancel" }, guest)).toMatchObject({ ok: false, code: "cancel_blocked", eligibility: "locked_contact_store" });
    expect(w.calls).toEqual([]);
  });
  it("paid deposit: staff review, not self-service", async () => {
    expect(await run(world({ is_deposit_paid: true }), { type: "cancel" }, guest)).toMatchObject({
      ok: false, eligibility: "staff_review_required", refundRequestAvailable: true,
    });
  });
  it.each(["checked_in", "completed"])("no cancel after %s", async (status) => {
    expect(await run(world({ status }), { type: "cancel" }, guest)).toMatchObject({ ok: false });
  });
  it("already cancelled", async () => {
    expect(await run(world({ status: "cancelled" }), { type: "cancel" }, guest)).toMatchObject({ ok: false, message: "此訂位已取消" });
  });
  it("guests cannot confirm or complete", async () => {
    expect(await run(world(), { type: "complete" }, guest)).toMatchObject({ ok: false });
  });
});

describe("reschedule", () => {
  const next = (h: number) => ({
    type: "reschedule" as const,
    start: new Date(Date.now() + h * H).toISOString(),
    end: new Date(Date.now() + (h + 2) * H).toISOString(),
  });
  it("moves the booking and fans out the effects", async () => {
    const w = world();
    expect(await run(w, next(100), guest)).toMatchObject({ ok: true });
    expect(w.calls).toEqual([
      "update", "reconfirm:guest_reschedule", "resetReminders", "guestRescheduledCard", "groupRescheduledCard", "waitlist",
    ]);
  });
  it("guest inside 24h of the current slot", async () => {
    const w = world({ start_time: new Date(Date.now() + 5 * H).toISOString() });
    expect(await run(w, next(100), guest)).toMatchObject({ ok: false, code: "too_soon" });
  });
  it("guest new slot inside 24h", async () => {
    expect(await run(world(), next(10), guest)).toMatchObject({ ok: false, code: "too_soon" });
  });
  it("same schedule is a no-op", async () => {
    const w = world();
    const r = await run(w, { type: "reschedule", start: w.row.start_time, end: w.row.end_time }, guest);
    expect(r).toMatchObject({ ok: true, already: true });
    expect(w.calls).toEqual([]);
  });
  it("conflict propagates the bookable reason", async () => {
    expect(await run(world({}, { ok: false, reason: "conflict" }), next(100), guest)).toMatchObject({ ok: false, httpStatus: 409 });
  });
  it("cancelled booking cannot move", async () => {
    expect(await run(world({ status: "cancelled" }), next(100), guest)).toMatchObject({ ok: false, message: "此訂位已取消" });
  });
  it("admin is not bound by the 24h guest rule", async () => {
    expect(await run(world(), next(5), admin)).toMatchObject({ ok: true });
  });
});

describe("allowedActions (what the guest page renders)", () => {
  const start = (h: number) => new Date(Date.now() + h * H).toISOString();
  it.each([
    ["pending", false, 72, ["cancel", "reschedule"]],
    ["confirmed", false, 72, ["cancel", "reschedule"]],
    ["confirmed", false, 10, []],
    ["confirmed", true, 72, ["reschedule"]],
    ["confirmed", true, 10, []],
    ["checked_in", false, 72, []],
    ["completed", false, 72, []],
    ["cancelled", false, 72, []],
  ])("%s paid=%s in %sh", (status, paid, h, expected) => {
    expect(guestAllowedActions({ status, is_deposit_paid: paid, start_time: start(h) })).toEqual(expected);
  });
  it("agrees with the transition it gates", async () => {
    for (const paid of [false, true]) for (const h of [10, 72]) {
      const w = world({ is_deposit_paid: paid, start_time: start(h), end_time: start(h + 2) });
      const allowed = guestAllowedActions(w.row).includes("cancel");
      expect((await run(w, { type: "cancel" }, guest)).ok).toBe(allowed);
    }
  });
});

describe("intentForStatusChange (admin PATCH status)", () => {
  it("noop, mapped, refused", () => {
    expect(intentForStatusChange("pending", "pending")).toEqual({ noop: true });
    expect(intentForStatusChange("pending", "confirmed")).toEqual({ intent: { type: "confirm" } });
    expect(intentForStatusChange("completed", "pending")).toHaveProperty("error");
    expect(intentForStatusChange("pending", "reserved")).toHaveProperty("error");
    expect(intentForStatusChange("pending", "rejected")).toHaveProperty("error");
    expect(intentForStatusChange("cancelled", "confirmed")).toMatchObject({ error: expect.stringContaining("還原") });
  });
});

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
