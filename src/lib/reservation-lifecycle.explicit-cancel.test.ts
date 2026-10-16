/**
 * ADR-012: removing the deposit-deadline auto-cancel must not change explicit
 * cancellation. A guest or staff member who cancels still frees the slot and
 * notifies the waitlist, whether or not the deposit was paid.
 */
import { describe, expect, it } from "vitest";
import { transitionReservation, type Actor, type Effects, type Snapshot } from "./reservation-lifecycle";

const H = 3_600_000;

function world(over: Partial<Snapshot> = {}) {
  const row: Snapshot = {
    id: "r1", status: "pending", room_id: "room-1", booking_code: "ABC123",
    start_time: new Date(Date.now() + 72 * H).toISOString(),
    end_time: new Date(Date.now() + 74 * H).toISOString(),
    guest_count: 4, is_deposit_paid: false, customer_name: "王", phone: "09",
    line_user_id: "U1", review_invited_at: null, branch_name: "大安", ...over,
  };
  const calls: string[] = [];
  const waitlist: [string, string, string][] = [];
  const fx: Effects = {
    load: async (id) => (id === row.id ? { ...row } : null),
    update: async (_id, patch) => { calls.push(`update:${String(patch.status)}`); Object.assign(row, patch); },
    cancelPreorder: async (_i, reason) => { calls.push(`cancelPreorder:${reason}`); },
    lockPreorder: async () => { calls.push("lockPreorder"); },
    requirePreorderReconfirmation: async () => { calls.push("reconfirm"); },
    resetReminders: async () => { calls.push("resetReminders"); },
    notifyWaitlist: async (roomId, start, end) => { calls.push("waitlist"); waitlist.push([roomId, start, end]); },
    guestCancelled: async () => { calls.push("guestCancelledCard"); },
    guestRescheduled: async () => { calls.push("guestRescheduledCard"); },
    groupRescheduled: async () => { calls.push("groupRescheduledCard"); },
    requestDeposit: async () => { calls.push("requestDeposit"); return "sent"; },
    sendReviewInvite: async () => { calls.push("reviewInvite"); },
    checkBookable: (async () => ({ ok: true })) as Effects["checkBookable"],
    audit: () => {},
  };
  return { row, calls, waitlist, fx };
}

const guest: Actor = { kind: "guest" };
const staff: Actor = { kind: "admin", userId: "staff-1", label: "staff" };

describe("explicit cancellation still works after ADR-012", () => {
  it.each(["pending", "confirmed"])("guest cancels an unpaid %s booking → cancelled, card, waitlist", async (status) => {
    const w = world({ status });
    const r = await transitionReservation("r1", { type: "cancel" }, guest, w.fx);
    expect(r).toMatchObject({ ok: true, status: "cancelled" });
    expect(w.row.status).toBe("cancelled");
    expect(w.calls).toEqual(["update:cancelled", "cancelPreorder:guest_cancel", "guestCancelledCard", "waitlist"]);
    expect(w.waitlist).toEqual([[w.row.room_id, w.row.start_time, w.row.end_time]]);
  });

  it.each([
    ["pending", false],
    ["confirmed", false],
    ["confirmed", true],
  ])("staff cancels a %s booking (deposit paid=%s) → cancelled, card, waitlist", async (status, paid) => {
    const w = world({ status, is_deposit_paid: paid });
    const r = await transitionReservation("r1", { type: "cancel" }, staff, w.fx);
    expect(r).toMatchObject({ ok: true, status: "cancelled" });
    expect(w.calls).toEqual(["update:cancelled", "cancelPreorder:admin_cancel_or_reject", "guestCancelledCard", "waitlist"]);
    expect(w.waitlist).toHaveLength(1);
  });
});
