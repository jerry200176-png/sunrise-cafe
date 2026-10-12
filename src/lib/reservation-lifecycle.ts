/**
 * Reservation lifecycle: the one module that owns "what may happen to a
 * reservation, and everything that follows".
 *
 *   transitionReservation(id, intent, actor, effects?) -> Result
 *
 * It owns the allowed-transition table, preorder side effects, waitlist
 * release, which guest/group LINE message goes out (content lives in
 * line-cards / line-notify, unchanged), the review invite and the audit log.
 * Routes keep only auth, parsing and HTTP mapping (`transitionHttp`).
 *
 * Deposit approval is NOT a transition: `markDepositPaid` (next change) is
 * the call point; `confirm` only requests the deposit from the guest.
 */
import { createClient } from "@supabase/supabase-js";
import type { ReservationStatus } from "@/types";
import { evaluateGuestCancel } from "@/lib/cancel-refund-policy";
import { BOOKABLE_HTTP, checkBookable, type BookableReason } from "@/lib/bookable";
import { logOps } from "@/lib/ops-log";
import { updateReservationAdmin } from "@/lib/supabase-admin";
import { cancelReservationPreorder, lockReservationPreorder, requirePreorderReconfirmation } from "@/lib/reservation-preorder";
import { resetLineReminderDeliveries, holdDepositRelease, hasDepositReleaseHold } from "@/lib/line-delivery";
import { computeDepositDeadline, shouldAutoRelease } from "@/lib/deposit-deadline";
import { notifyWaitlist } from "@/lib/waitlist";
import { deliverLineGuestNotification } from "@/lib/line-guest-delivery";
import { sendLineFlexMessage, buildReviewInviteFlex } from "@/lib/line";
import { buildGuestBookingCancelledFlex, buildGuestBookingRescheduledFlex } from "@/lib/line-cards";
import { sendLineFlexToBranchGroup, buildRescheduleGroupFlex } from "@/lib/line-notify";
import { branchLineGroupIdForReservation } from "@/lib/branch-line-group";
import { stableLineRetryKey } from "@/lib/line-retry-key";
import { sendDepositPaymentRequest } from "@/lib/payment-request-line";
import { fetchSettings } from "@/lib/supabase-fetch";
import { resolveBranchGuestSettings } from "@/lib/branch-guest-settings";

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export type CancelReason = "manual" | "deposit_deadline";

export type Intent =
  | { type: "confirm" }
  | { type: "check_in" }
  | { type: "complete" }
  | { type: "no_show" }
  | { type: "cancel"; reason?: CancelReason }
  | { type: "restore" }
  | { type: "reschedule"; start: string; end: string; guestCount?: number | null };

export type Actor =
  | { kind: "admin"; userId?: string | null; label?: string | null }
  | { kind: "guest" }
  | { kind: "system"; job: string };

/** What the module needs to know about a reservation. */
export type Snapshot = {
  id: string;
  status: string;
  created_at?: string | null;
  room_id: string;
  start_time: string;
  end_time: string;
  guest_count: number | null;
  is_deposit_paid: boolean;
  booking_code: string;
  customer_name: string;
  phone: string;
  line_user_id: string | null;
  review_invited_at: string | null;
  branch_name: string | null;
};

export type Failure = {
  ok: false;
  code:
    | "not_found"
    | "invalid_transition"
    | "cancel_blocked"
    | "too_soon"
    | "not_bookable"
    | "restore_hold_failed";
  message: string;
  httpStatus: number;
  eligibility?: string;
  refundRequestAvailable?: boolean;
};
export type Result =
  | { ok: true; status: string; already?: boolean; lineResult?: string | null }
  | Failure;

/** Admin transition table. `restore` (cancelled -> back) is the only way out of cancelled. */
const ADMIN_TABLE: Record<string, Partial<Record<Intent["type"], ReservationStatus>>> = {
  pending: { confirm: "confirmed", check_in: "checked_in", complete: "completed", cancel: "cancelled", no_show: "no_show" },
  confirmed: { check_in: "checked_in", complete: "completed", cancel: "cancelled", no_show: "no_show" },
  checked_in: { complete: "completed", cancel: "cancelled" },
  completed: {},
  cancelled: { restore: "pending" },
  // 沒來：店員標記，只有標記過的才算放鳥；標錯可以還原。
  no_show: { restore: "pending" },
};

const STATUS_TO_INTENT: Record<string, "confirm" | "check_in" | "complete" | "cancel" | "no_show"> = {
  confirmed: "confirm",
  checked_in: "check_in",
  completed: "complete",
  cancelled: "cancel",
  no_show: "no_show",
};

/**
 * Translate an admin "set status to X" request (legacy PATCH `status`) into an
 * intent, validated against the transition table. `noop` = already there.
 */
export function intentForStatusChange(
  current: string,
  requested: string
): { intent: Intent } | { noop: true } | { error: string } {
  if (requested === current) return { noop: true };
  const type = STATUS_TO_INTENT[requested];
  if (!type) return { error: `不支援的狀態：${requested}` };
  if (!ADMIN_TABLE[current]?.[type]) {
    return {
      error: current === "cancelled" ? "此訂位已取消，請使用「還原」" : `無法從「${current}」改為「${requested}」`,
    };
  }
  return { intent: { type } };
}

export type GuestAction = "cancel" | "reschedule";

/** Same policy `transitionReservation` enforces for guests, for UIs to render. */
export function guestAllowedActions(
  r: { status: string; is_deposit_paid: boolean; start_time: string },
  nowMs: number = Date.now()
): GuestAction[] {
  if (r.status !== "pending" && r.status !== "confirmed") return [];
  const startMs = new Date(r.start_time).getTime();
  const actions: GuestAction[] = [];
  if (evaluateGuestCancel({ isDepositPaid: r.is_deposit_paid, startTimeMs: startMs, nowMs }).allowed) {
    actions.push("cancel");
  }
  if (startMs - nowMs >= TWENTY_FOUR_HOURS_MS) actions.push("reschedule");
  return actions;
}

/** Seam: everything the module does to the outside world. */
export type Effects = {
  load(id: string): Promise<Snapshot | null>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Compare-and-set the status; false when someone else changed it first. */
  setStatusIf(id: string, from: string, to: string): Promise<boolean>;
  /** Keep the deposit-deadline cron from re-releasing a restored unpaid booking. */
  holdDepositRelease(s: Snapshot): Promise<void>;
  depositHeld(id: string): Promise<boolean>;
  cancelPreorder(id: string, reason: string): Promise<void>;
  lockPreorder(id: string): Promise<void>;
  requirePreorderReconfirmation(id: string, reason: string, actor: string): Promise<void>;
  resetReminders(id: string): Promise<void>;
  notifyWaitlist(roomId: string, start: string, end: string): Promise<void>;
  guestCancelled(s: Snapshot): Promise<void>;
  guestRescheduled(s: Snapshot, next: { start: string; end: string }): Promise<void>;
  groupRescheduled(s: Snapshot, next: { start: string; end: string; guestCount: number | null }): Promise<void>;
  requestDeposit(id: string, actorUserId?: string | null): Promise<string | null>;
  sendReviewInvite(s: Snapshot): Promise<void>;
  checkBookable: typeof checkBookable;
  audit(entry: Record<string, unknown>): void;
};

const fail = (code: Failure["code"], message: string, httpStatus: number, extra: Partial<Failure> = {}): Failure => ({
  ok: false, code, message, httpStatus, ...extra,
});

function actorLabel(a: Actor): string {
  return a.kind === "admin" ? a.userId ?? a.label ?? "admin" : a.kind === "system" ? a.job : "guest";
}

export async function transitionReservation(
  id: string,
  intent: Intent,
  actor: Actor,
  effects: Effects = supabaseEffects
): Promise<Result> {
  const snap = await effects.load(id);
  if (!snap) return fail("not_found", "找不到訂位", 404);
  const now = Date.now();

  if (intent.type === "reschedule") return reschedule(snap, intent, actor, effects, now);

  if (actor.kind === "guest") {
    if (intent.type !== "cancel") return fail("invalid_transition", "不支援的操作", 400);
    if (snap.status === "cancelled") return fail("invalid_transition", "此訂位已取消", 400);
    if (snap.status !== "pending" && snap.status !== "confirmed") {
      return fail("cancel_blocked", "目前無法自行取消，請來電店家", 400);
    }
    const decision = evaluateGuestCancel({
      isDepositPaid: snap.is_deposit_paid,
      startTimeMs: new Date(snap.start_time).getTime(),
      nowMs: now,
    });
    if (!decision.allowed) {
      logOps("guest", "guest.cancel_blocked", { eligibility: decision.eligibility, reservation_id: id });
      return fail("cancel_blocked", decision.message ?? "目前無法自行取消", 400, {
        eligibility: decision.eligibility,
        refundRequestAvailable: decision.eligibility === "staff_review_required",
      });
    }
  }

  const target = ADMIN_TABLE[snap.status]?.[intent.type];
  if (!target) {
    const msg =
      snap.status === "cancelled" && intent.type !== "restore"
        ? "此訂位已取消，請使用「還原」"
        : `目前狀態無法執行此操作（${snap.status}）`;
    return fail("invalid_transition", msg, 409);
  }

  if (intent.type === "no_show" && new Date(snap.start_time).getTime() > now) {
    return fail("invalid_transition", "還沒到訂位時間，不能標記沒來", 409);
  }

  if (intent.type === "restore") {
    // The slot may have been taken since; the DB exclusion constraint stays the last line of defence.
    const bookable = await effects.checkBookable(snap.room_id, snap.start_time, snap.end_time, {
      actor: "admin",
      excludeId: id,
    });
    if (!bookable.ok) return notBookable(bookable.reason);
  }

  const restoredStatus: ReservationStatus = snap.is_deposit_paid ? "confirmed" : "pending";
  const nextStatus = intent.type === "restore" ? restoredStatus : target;
  if (intent.type === "cancel" && intent.reason === "deposit_deadline" && (await effects.depositHeld(id))) {
    // Restored by staff while this cron run was in flight: the hold wins.
    return fail("invalid_transition", "訂金期限已由店家保留（已還原），不自動釋放", 409);
  }
  if (intent.type === "restore") {
    // Unpaid and already past the deposit deadline: write the hold FIRST (while still
    // cancelled) so the cron can never see a restored-but-unheld booking. A failed hold
    // refuses the restore with nothing changed.
    const deadline = snap.created_at ? computeDepositDeadline(snap.created_at, snap.start_time) : null;
    if (!snap.is_deposit_paid && (!deadline || shouldAutoRelease(deadline, new Date(now)))) {
      try {
        await effects.holdDepositRelease(snap);
      } catch (err) {
        console.error("[lifecycle] restore hold failed, restore refused:", err);
        return fail("restore_hold_failed", "還原失敗（無法保留訂金期限），請稍後再試", 500);
      }
    }
    // Compare-and-set: a concurrent restore (double click, two staff) loses instead of re-applying.
    if (!(await effects.setStatusIf(id, snap.status, nextStatus))) {
      return fail("invalid_transition", "此訂位已被還原或狀態已變更，請重新整理", 409);
    }
    // Never report success for a booking that is no longer in the restored state.
    const after = await effects.load(id);
    if (after?.status !== nextStatus) {
      return fail("invalid_transition", `還原後訂位狀態已被其他操作改變（${after?.status ?? "不存在"}），請重新整理`, 409);
    }
  } else {
    await effects.update(id, { status: nextStatus });
  }
  effects.audit({
    reservation_id: id,
    booking_code: snap.booking_code,
    intent: intent.type,
    from: snap.status,
    to: nextStatus,
    actor: actor.kind,
    actor_id: actorLabel(actor),
    ...(intent.type === "cancel" ? { reason: intent.reason ?? "manual" } : {}),
  });

  let lineResult: string | null = null;
  switch (intent.type) {
    case "cancel": {
      const reason =
        intent.reason === "deposit_deadline" ? "deposit_deadline_auto_cancel"
        : actor.kind === "guest" ? "guest_cancel" : "admin_cancel_or_reject";
      await effects.cancelPreorder(id, reason);
      // The deposit-deadline job sends its own release cards (guest + staff group).
      if (intent.reason !== "deposit_deadline" && snap.line_user_id) {
        await safely("guest cancellation notify", () => effects.guestCancelled(snap));
      }
      effects.notifyWaitlist(snap.room_id, snap.start_time, snap.end_time).catch((err) =>
        console.error("[lifecycle] waitlist notify failed:", err)
      );
      break;
    }
    case "confirm":
      lineResult = await effects.requestDeposit(id, actor.kind === "admin" ? actor.userId : null);
      break;
    case "complete":
      await effects.lockPreorder(id);
      if (snap.line_user_id && !snap.review_invited_at) {
        await safely("review invite", () => effects.sendReviewInvite(snap));
      }
      break;
    default:
      break;
  }
  return { ok: true, status: nextStatus, lineResult };
}

async function reschedule(
  snap: Snapshot,
  intent: Extract<Intent, { type: "reschedule" }>,
  actor: Actor,
  effects: Effects,
  now: number
): Promise<Result> {
  if (snap.status === "cancelled") return fail("invalid_transition", "此訂位已取消", 400);
  if (snap.status !== "pending" && snap.status !== "confirmed") {
    return fail("invalid_transition", `目前狀態無法改期（${snap.status}）`, 409);
  }
  const guest = actor.kind === "guest";
  if (guest) {
    if (new Date(snap.start_time).getTime() - now < TWENTY_FOUR_HOURS_MS) {
      return fail("too_soon", "預約時間 24 小時內不可自行改期，請來電店家", 400);
    }
    if (new Date(intent.start).getTime() - now < TWENTY_FOUR_HOURS_MS) {
      return fail("too_soon", "新時段須在 24 小時後，請選擇更晚的時間", 400);
    }
  }
  const bookable = await effects.checkBookable(snap.room_id, intent.start, intent.end, {
    actor: guest ? "guest" : "admin",
    excludeId: snap.id,
  });
  if (!bookable.ok) return notBookable(bookable.reason);

  const guestCount = intent.guestCount ?? snap.guest_count;
  const same =
    new Date(intent.start).getTime() === new Date(snap.start_time).getTime() &&
    new Date(intent.end).getTime() === new Date(snap.end_time).getTime() &&
    guestCount === snap.guest_count;
  if (same) return { ok: true, status: snap.status, already: true };

  await effects.update(snap.id, {
    start_time: intent.start,
    end_time: intent.end,
    guest_count: guestCount,
    is_notified: false,
    d1_guest_reminder_sent_at: null,
  });
  await effects.requirePreorderReconfirmation(snap.id, guest ? "guest_reschedule" : "admin_reservation_change", actorLabel(actor));
  await effects.resetReminders(snap.id);
  effects.audit({
    reservation_id: snap.id,
    booking_code: snap.booking_code,
    intent: "reschedule",
    from: snap.status,
    to: snap.status,
    actor: actor.kind,
    actor_id: actorLabel(actor),
    old_start: snap.start_time,
    new_start: intent.start,
  });
  const next = { start: intent.start, end: intent.end };
  if (snap.line_user_id) await safely("guest reschedule notify", () => effects.guestRescheduled(snap, next));
  await safely("group reschedule notify", () => effects.groupRescheduled(snap, { ...next, guestCount }));
  effects.notifyWaitlist(snap.room_id, snap.start_time, snap.end_time).catch((err) =>
    console.error("[lifecycle] waitlist notify failed:", err)
  );
  return { ok: true, status: snap.status };
}

function notBookable(reason: BookableReason): Failure {
  const { status, error } = BOOKABLE_HTTP[reason];
  return fail("not_bookable", error, status);
}

async function safely(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[lifecycle] ${what} failed:`, err);
  }
}

/** HTTP body for a failure; keeps the guest-cancel response shape stable. */
export function transitionHttp(f: Failure): { status: number; body: Record<string, unknown> } {
  return {
    status: f.httpStatus,
    body: {
      error: f.message,
      ...(f.eligibility ? { eligibility: f.eligibility, refund_request_available: f.refundRequestAvailable } : {}),
    },
  };
}

/* ---------------------------------------------------------------- adapter */

type Rel<T> = T | T[] | null | undefined;
const first = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

type BranchRel = { id?: string; name?: string; display_name?: string | null; google_review_url?: string | null };

async function loadBranch(id: string): Promise<BranchRel | null> {
  const { data } = await db()
    .from("reservations")
    .select("room:rooms(branch:branches(id, name, display_name, google_review_url))")
    .eq("id", id)
    .maybeSingle();
  const room = first((data as { room?: Rel<{ branch?: Rel<BranchRel> }> } | null)?.room);
  return first(room?.branch);
}

export const loadReservation = (id: string) => supabaseEffects.load(id);

export const supabaseEffects: Effects = {
  async load(id) {
    const { data } = await db()
      .from("reservations")
      .select(
        "id, status, created_at, room_id, start_time, end_time, guest_count, is_deposit_paid, booking_code, customer_name, phone, line_user_id, review_invited_at, room:rooms(branch:branches(name))"
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as Snapshot & { room?: Rel<{ branch?: Rel<{ name?: string }> }> };
    const { room, ...rest } = row;
    return { ...rest, is_deposit_paid: Boolean(rest.is_deposit_paid), branch_name: first(first(room)?.branch)?.name ?? null };
  },
  async update(id, patch) {
    await updateReservationAdmin(id, patch);
  },
  async setStatusIf(id, from, to) {
    const { data, error } = await db().from("reservations").update({ status: to }).eq("id", id).eq("status", from).select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },
  async holdDepositRelease(s) {
    await holdDepositRelease(s.id, s.start_time);
  },
  async depositHeld(id) {
    return hasDepositReleaseHold(id);
  },
  async cancelPreorder(id, reason) {
    await cancelReservationPreorder(id, reason);
  },
  async lockPreorder(id) {
    await lockReservationPreorder(id);
  },
  async requirePreorderReconfirmation(id, reason, actor) {
    await requirePreorderReconfirmation(id, reason, actor);
  },
  async resetReminders(id) {
    await resetLineReminderDeliveries(id);
  },
  async notifyWaitlist(roomId, start, end) {
    await notifyWaitlist(roomId, start, end);
  },
  async guestCancelled(s) {
    const result = await deliverLineGuestNotification({
      notificationType: "booking_cancelled",
      reservationId: s.id,
      recipientId: s.line_user_id!,
      send: () =>
        sendLineFlexMessage(
          s.line_user_id!,
          "訂位已取消",
          buildGuestBookingCancelledFlex({
            customerName: s.customer_name ?? "您好",
            branchName: s.branch_name ?? "昇咖啡",
            bookingCode: s.booking_code,
            startTime: s.start_time,
            endTime: s.end_time,
          }),
          { reservationId: s.id }
        ),
    });
    if (result === "error") console.error("[lifecycle] guest cancellation notify failed");
  },
  async guestRescheduled(s, next) {
    await deliverLineGuestNotification({
      notificationType: "booking_rescheduled",
      reservationId: s.id,
      recipientId: String(s.line_user_id),
      eventKey: `${next.start}|${next.end}`,
      send: () =>
        sendLineFlexMessage(
          String(s.line_user_id),
          "訂位已改期",
          buildGuestBookingRescheduledFlex({
            customerName: s.customer_name,
            branchName: s.branch_name ?? "昇咖啡",
            bookingCode: s.booking_code,
            oldStart: s.start_time,
            oldEnd: s.end_time,
            newStart: next.start,
            newEnd: next.end,
          }),
          { reservationId: s.id }
        ),
    });
  },
  async groupRescheduled(s, next) {
    await sendLineFlexToBranchGroup(
      `客人改期：${s.customer_name}`,
      buildRescheduleGroupFlex({
        customerName: s.customer_name,
        phone: s.phone,
        bookingCode: s.booking_code,
        oldStart: s.start_time,
        oldEnd: s.end_time,
        newStart: next.start,
        newEnd: next.end,
      }),
      await branchLineGroupIdForReservation(db(), s.id),
      {
        retryKey: stableLineRetryKey("booking-rescheduled-group", s.id, next.start, next.end, String(next.guestCount ?? "")),
      }
    );
  },
  async requestDeposit(id, actorUserId) {
    const { result, detail } = await sendDepositPaymentRequest(id, { force: false, actorUserId });
    if (result === "error") console.error("[confirm] LINE 推播失敗:", detail);
    return detail ? `${result}: ${detail}` : result;
  },
  async sendReviewInvite(s) {
    const branch = await loadBranch(s.id);
    const { google_review_url: reviewUrl } = resolveBranchGuestSettings(branch, await fetchSettings());
    if (!reviewUrl) return;
    const flex = buildReviewInviteFlex({
      customerName: s.customer_name,
      branchName: branch?.display_name || branch?.name || "",
      reviewUrl,
    });
    await sendLineFlexMessage(s.line_user_id!, "感謝光臨昇昇咖啡", flex, { reservationId: s.id });
    await updateReservationAdmin(s.id, { review_invited_at: new Date().toISOString() });
  },
  checkBookable,
  audit: (entry) => logOps("admin", "reservation.transitioned", entry),
};
