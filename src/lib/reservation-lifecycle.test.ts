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
function world(over: Partial<Snapshot> = {}, bookable: { ok: true } | { ok: false; reason: "conflict" } = { ok: true }) {
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
    updateIfSnapshot: async (_id, expected, patch) => {
      const keys = Object.keys(expected) as (keyof typeof expected)[];
      if (keys.some((key) => row[key] !== expected[key])) return null;
      calls.push("update");
      Object.assign(row, patch);
      return { ...row };
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
    ["cancelled", "complete"], ["confirmed", "confirm"], ["completed", "restore"], ["checked_in", "confirm"],
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

  it("compare-and-set makes concurrent pending cancellation and check-in first-writer-wins", async () => {
    const cancelWins = world();
    const [cancelled, rejectedCheckIn] = await Promise.all([
      run(cancelWins, { type: "cancel" }, admin),
      run(cancelWins, { type: "check_in" }, admin),
    ]);
    expect(cancelled).toMatchObject({ ok: true, status: "cancelled" });
    expect(rejectedCheckIn).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(cancelWins.row.status).toBe("cancelled");
    expect(cancelWins.audits).toHaveLength(1);
    expect(cancelWins.audits[0]).toMatchObject({ intent: "cancel", from: "pending", to: "cancelled" });
    expect(cancelWins.calls).toContain("cancelPreorder:admin_cancel_or_reject");

    const checkInWins = world();
    const [checkedIn, rejectedCancel] = await Promise.all([
      run(checkInWins, { type: "check_in" }, admin),
      run(checkInWins, { type: "cancel" }, admin),
    ]);
    expect(checkedIn).toMatchObject({ ok: true, status: "checked_in" });
    expect(rejectedCancel).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(checkInWins.row.status).toBe("checked_in");
    expect(checkInWins.audits).toHaveLength(1);
    expect(checkInWins.audits[0]).toMatchObject({ intent: "check_in", from: "pending", to: "checked_in" });
    expect(checkInWins.calls).toEqual(["update"]);
  });

  it("refuses an overdue unpaid cancellation if payment wins before the atomic status write", async () => {
    const w = world();
    const write = w.fx.updateIfSnapshot!;
    w.fx.updateIfSnapshot = async (id, expected, patch) => {
      w.row.is_deposit_paid = true; // Simulated payment commit between cron read and cancellation CAS.
      return write(id, expected, patch);
    };

    const result = await transitionReservation(
      "r1",
      { type: "cancel", reason: "deposit_deadline" },
      { kind: "system", job: "deposit_deadline" },
      w.fx,
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(w.row).toMatchObject({ status: "pending", is_deposit_paid: true });
    expect(w.calls).toEqual([]);
    expect(w.audits).toEqual([]);
  });

  it.each([
    [false, true],
    [null, true],
    [true, false],
  ] as const)("only lets the deadline job cancel unpaid state %s", async (isDepositPaid, shouldCancel) => {
    const w = world({ is_deposit_paid: isDepositPaid });
    const result = await transitionReservation(
      "r1",
      { type: "cancel", reason: "deposit_deadline" },
      { kind: "system", job: "deposit_deadline" },
      w.fx,
    );

    expect(result.ok).toBe(shouldCancel);
    expect(w.row.status).toBe(shouldCancel ? "cancelled" : "pending");
    if (!shouldCancel) {
      expect(w.calls).toEqual([]);
      expect(w.audits).toEqual([]);
    }
  });

  it("does not report a competing completion as done while the winner's side effect is pending and fails", async () => {
    const w = world({ status: "checked_in" });
    const bothLoaded = new Promise<void>((resolve) => {
      let loads = 0;
      w.fx.load = async (id) => {
        const snapshot = id === w.row.id ? { ...w.row } : null;
        loads += 1;
        if (loads === 2) resolve();
        if (loads <= 2) await bothLoaded;
        return snapshot;
      };
    });
    let markLockStarted!: () => void;
    const lockStarted = new Promise<void>((resolve) => { markLockStarted = resolve; });
    let releaseLock!: () => void;
    const lockGate = new Promise<void>((resolve) => { releaseLock = resolve; });
    w.fx.lockPreorder = async () => {
      w.calls.push("lockPreorder");
      markLockStarted();
      await lockGate;
      throw new Error("preorder lock failed");
    };

    const first = run(w, { type: "complete" }, admin);
    const second = run(w, { type: "complete" }, admin);
    await lockStarted;
    const losingResult = await Promise.race([first, second]);
    expect(losingResult).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    releaseLock();
    const results = await Promise.allSettled([first, second]);

    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(w.row.status).toBe("completed");
    expect(w.audits).toHaveLength(1);
    expect(w.calls).toEqual(["update", "lockPreorder"]);
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
  it("uses the committed contact snapshot for cancellation notifications", async () => {
    const w = world();
    const write = w.fx.updateIfSnapshot!;
    w.fx.updateIfSnapshot = async (id, expected, patch) => {
      const committed = await write(id, expected, patch);
      if (!committed) return null;
      w.row.customer_name = "最新姓名";
      w.row.phone = "0988000000";
      w.row.line_user_id = "U2";
      return { ...w.row };
    };
    w.fx.guestCancelled = async (snapshot) => {
      w.calls.push("guestCancelled:" + snapshot.customer_name + ":" + snapshot.line_user_id);
    };

    await run(w, { type: "cancel" }, admin);

    expect(w.calls).toContain("guestCancelled:最新姓名:U2");
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
  it.each(["pending", "confirmed"])("is idempotent: already %s returns ok without writing", async (status) => {
    const w = world({ status });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status, already: true });
    expect(w.calls).toEqual([]);
    expect(w.audits).toEqual([]);
  });
  it("restores an auto-cancelled unpaid booking to pending, audits who did it, sends no LINE", async () => {
    const w = world({ status: "cancelled" });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(w.audits[0]).toMatchObject({ intent: "restore", from: "cancelled", to: "pending", actor: "admin", actor_id: "u1" });
    expect(w.calls).toEqual(["update"]);
  });
  it("uses compare-and-set; a concurrent restore that lost the race still reports success once", async () => {
    const w = world({ status: "cancelled" });
    w.fx.updateIfSnapshot = async () => {
      w.row.status = "pending"; // another admin restored first
      return null;
    };
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending", already: true });
    expect(w.audits).toEqual([]);
  });
  it("compare-and-set refuses when the booking moved somewhere else meanwhile", async () => {
    const w = world({ status: "cancelled" });
    w.fx.updateIfSnapshot = async () => {
      w.row.status = "completed";
      return null;
    };
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
  });
  it("compare-and-set writes only while the status is still cancelled", async () => {
    const w = world({ status: "cancelled" });
    const seen: string[] = [];
    w.fx.updateIfSnapshot = async (_id, expected, patch) => {
      seen.push(`${expected.status}->${String(patch.status)}`);
      Object.assign(w.row, patch);
      return { ...w.row };
    };
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(seen).toEqual(["cancelled->pending"]);
  });
  it("returns to confirmed when the deposit is already paid", async () => {
    const w = world({ status: "cancelled", is_deposit_paid: true });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "confirmed" });
  });
  it("preserves legacy NULL deposit state for CAS while restoring as unpaid", async () => {
    const w = world({ status: "cancelled", is_deposit_paid: null });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: true, status: "pending" });
    expect(w.row.is_deposit_paid).toBeNull();
  });
  it("is refused when the slot was taken meanwhile", async () => {
    const w = world({ status: "cancelled" }, { ok: false, reason: "conflict" });
    expect(await run(w, { type: "restore" }, admin)).toMatchObject({ ok: false, code: "not_bookable", httpStatus: 409 });
    expect(w.row.status).toBe("cancelled");
  });
});

describe("reschedule compare-and-set", () => {
  it("does not report an unchanged request as already successful from a stale snapshot", async () => {
    const w = world();
    const previousStart = w.row.start_time;
    const previousEnd = w.row.end_time;
    const movedStart = new Date(Date.now() + 120 * H).toISOString();
    w.fx.checkBookable = (async () => {
      w.row.start_time = movedStart;
      w.row.end_time = new Date(Date.parse(movedStart) + 2 * H).toISOString();
      return { ok: true };
    }) as Effects["checkBookable"];

    const result = await run(w, { type: "reschedule", start: previousStart, end: previousEnd }, admin);

    expect(result).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(w.row.start_time).toBe(movedStart);
    expect(w.calls).toEqual([]);
    expect(w.audits).toEqual([]);
  });

  it("allows only one of two reschedules based on the same old snapshot", async () => {
    const w = world();
    const firstStart = new Date(Date.now() + 120 * H).toISOString();
    const secondStart = new Date(Date.now() + 144 * H).toISOString();
    const [first, second] = await Promise.all([
      run(w, { type: "reschedule", start: firstStart, end: new Date(Date.parse(firstStart) + 2 * H).toISOString() }, admin),
      run(w, { type: "reschedule", start: secondStart, end: new Date(Date.parse(secondStart) + 2 * H).toISOString() }, admin),
    ]);

    expect(first).toMatchObject({ ok: true, status: "pending" });
    expect(second).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(w.row.start_time).toBe(firstStart);
    expect(w.audits).toHaveLength(1);
    expect(w.calls.filter((call) => call === "resetReminders")).toHaveLength(1);
    expect(w.calls.filter((call) => call.startsWith("reconfirm:"))).toHaveLength(1);
  });

  it("prevents a stale cancellation from cancelling a booking after its time was changed", async () => {
    const w = world();
    const nextStart = new Date(Date.now() + 120 * H).toISOString();
    let releaseBookable!: () => void;
    const bookableGate = new Promise<void>((resolve) => { releaseBookable = resolve; });
    let markCancelWaiting!: () => void;
    const cancelWaiting = new Promise<void>((resolve) => { markCancelWaiting = resolve; });
    let markRescheduleWritten!: () => void;
    const rescheduleWritten = new Promise<void>((resolve) => { markRescheduleWritten = resolve; });
    const write = w.fx.updateIfSnapshot!;
    w.fx.checkBookable = (async () => {
      await bookableGate;
      return { ok: true };
    }) as Effects["checkBookable"];
    w.fx.updateIfSnapshot = async (id, expected, patch) => {
      if (patch.status === "cancelled") {
        markCancelWaiting();
        await rescheduleWritten;
      }
      const won = await write(id, expected, patch);
      if (won && patch.start_time) markRescheduleWritten();
      return won;
    };

    const cancellation = run(w, { type: "cancel" }, admin);
    const reschedule = run(w, {
      type: "reschedule",
      start: nextStart,
      end: new Date(Date.parse(nextStart) + 2 * H).toISOString(),
    }, admin);
    await cancelWaiting;
    releaseBookable();
    const [cancelResult, rescheduleResult] = await Promise.all([cancellation, reschedule]);

    expect(cancelResult).toMatchObject({ ok: false, code: "invalid_transition", httpStatus: 409 });
    expect(rescheduleResult).toMatchObject({ ok: true, status: "pending" });
    expect(w.row).toMatchObject({ status: "pending", start_time: nextStart });
    expect(w.calls).not.toContain("cancelPreorder:admin_cancel_or_reject");
    expect(w.calls.filter((call) => call === "waitlist")).toHaveLength(1);
    expect(w.calls).not.toContain("guestCancelledCard");
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ intent: "reschedule", old_start: expect.not.stringContaining(nextStart), new_start: nextStart });
  });
});

describe("guest cancel policy", () => {
  it("unpaid, more than 24h ahead: allowed", async () => {
    expect(await run(world(), { type: "cancel" }, guest)).toMatchObject({ ok: true });
  });
  it("legacy NULL deposit state follows the unpaid guest-cancel policy", async () => {
    expect(await run(world({ is_deposit_paid: null }), { type: "cancel" }, guest)).toMatchObject({ ok: true });
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
