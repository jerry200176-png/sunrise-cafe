/**
 * Idempotent LINE notification when reservation payment transitions to approved.
 * Sends:
 *  1. Guest Bot personal Flex ("訂金已確認") to `line_user_id` if present.
 *  2. Staff LINE group notification ("💰 客人已付訂金：...").
 *
 * Cross-instance idempotency, provider-level retry, and fault-tolerance guarantees:
 *  1. Provider-level idempotent retry with X-Line-Retry-Key from the first request:
 *     Every push attaches an X-Line-Retry-Key hexadecimal UUID header.
 *     If LINE already accepted a request with that key, LINE returns HTTP 409 Conflict with
 *     `x-line-accepted-request-id`. We reconcile 409 as accepted by LINE Platform without duplicating messages.
 *  2. Stable UUID persistence:
 *     Stable UUIDs are generated on the first request and persisted to `reservations`
 *     (`deposit_approved_retry_key`, `deposit_approved_guest_retry_key`, `deposit_approved_retry_key_created_at`).
 *     The exact same keys are reused across timeout, 5xx, or lease expiration.
 *  3. DB lease expiration does NOT regenerate the retry key:
 *     When the 60s `deposit_approved_claim_at` lease expires, subsequent retries preserve the
 *     existing persisted retry keys.
 *  4. 24-hour LINE retention window constraint & reconciliation safeguard:
 *     Per official LINE documentation, retry keys are held by LINE for 24 hours. If retrying
 *     after 24 hours, if any provider request with the previous key may have been attempted/accepted,
 *     that state is ambiguous. Automatic delivery is halted and the system enters an explicit
 *     `reconciliation_required` state to prevent duplicate delivery. Fresh keys are created ONLY when
 *     either:
 *     (a) no retry key ever existed (first logical notification), OR
 *     (b) an operator explicitly authorizes a safe retry following reconciliation inspection
 *         (via `operatorConfirmedSafeRetry` / `reconciliationApprovedRetry`). Note that human
 *         inspection of LINE OA/staff group does NOT prove that no provider request occurred;
 *         rather, it represents deliberate operator authorization to mint a fresh key and proceed.
 *  5. Accepted by LINE Platform contract:
 *     `deposit_approved_notified_at` is stamped ONLY when LINE push is confirmed accepted by LINE Platform
 *     (HTTP 200 or 409). Note that per LINE API documentation, HTTP 2xx and 409+x-line-accepted-request-id
 *     signify "accepted by LINE Platform" for processing/delivery, not guaranteed delivered to end-user device.
 *     On transient errors (5xx/timeout), the claim lease is released immediately and `deposit_approved_notified_at`
 *     remains NULL.
 *  6. Partial unique index & audit in `ops_events`:
 *     Every provider attempt is recorded (`payment.approved_attempt`), confirmed acceptance is recorded as
 *     `payment.approved_notified`, and ambiguous expired states record `payment.approved_notification_reconciliation_required`.
 */
import { getDepositAmount } from "@/lib/booking-utils";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  sendLineFlexToBranchGroup,
  buildPaymentConfirmedFlex,
  isLineConfigured,
  sendLineMessage,
} from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import { branchLineGroupIdForReservation } from "@/lib/branch-line-group";
import { buildGuestPaymentApprovedFlex } from "@/lib/line-cards";
import { signLookupToken } from "@/lib/lookup-token";

function defaultClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const inFlightSends = new Set<string>();

/** Maximum lease duration for in-flight dispatch claim before assuming process crash (60s) */
export const DISPATCH_CLAIM_LEASE_MS = 60_000;

/** LINE Platform retry key retention window (24 hours). Beyond 24h, LINE treats the key as brand new. */
export const LINE_RETRY_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isLineRetryKeyExpired(
  keyCreatedAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!keyCreatedAt) return true;
  const createdAtMs = new Date(keyCreatedAt).getTime();
  if (isNaN(createdAtMs)) return true;
  return nowMs - createdAtMs >= LINE_RETRY_KEY_MAX_AGE_MS;
}

export function formatReconciliationRequiredAlert(params: {
  reservationId: string;
  bookingCode: string;
  customerName: string;
  groupRetryKey: string | null;
  retryKeyCreatedAt: string | null;
}): string {
  return (
    `⚠️【LINE 訂金通知需人工對帳】\n` +
    `訂位編號：${params.bookingCode}\n` +
    `顧客姓名：${params.customerName}\n` +
    `原因：LINE 24小時重試窗口已過期，可能曾嘗試推播，已停止自動補送以防重複通知。\n` +
    `請執行對帳確認 LINE OA / 群組推播記錄：\n` +
    `• 已送出：scripts/reconcile-payment-notification.mjs ${params.reservationId} --mark-sent\n` +
    `• 確認未送出：scripts/reconcile-payment-notification.mjs ${params.reservationId} --safe-retry\n` +
    `時間：${new Date().toISOString()}`
  );
}

export type NotifyPaymentApprovedResult = {
  ok: boolean;
  already_notified?: boolean;
  guest_notified?: boolean;
  group_notified?: boolean;
  accepted_by_platform?: boolean;
  reconciliation_required?: boolean;
  group_retry_key?: string;
  guest_retry_key?: string;
  error?: string;
  reason?: string;
};

export type PaymentNotificationStatus =
  | "accepted_by_platform"
  | "already_notified"
  | "not_bound"
  | "not_configured"
  | "failed";

export function paymentNotificationStatus(
  result: NotifyPaymentApprovedResult | null | undefined
): PaymentNotificationStatus {
  if (result?.ok && result.already_notified) return "already_notified";
  if (result?.ok && result.accepted_by_platform) return "accepted_by_platform";
  if (result?.error === "no_line_id") return "not_bound";
  if (result?.error === "admin_unconfigured") return "not_configured";
  return "failed";
}

type ReservationNotifyTarget = {
  id: string;
  customer_name: string;
  booking_code: string;
  start_time: string;
  end_time: string;
  deposit_payment_note: string | null;
  line_user_id: string | null;
  status: string;
  total_price: number | null;
  is_deposit_paid: boolean;
  deposit_approved_notified_at?: string | null;
  deposit_approved_claim_at?: string | null;
  deposit_approved_retry_key?: string | null;
  deposit_approved_guest_retry_key?: string | null;
  deposit_approved_retry_key_created_at?: string | null;
};

export function isDepositApprovalNotificationEligible(
  reservation: Pick<ReservationNotifyTarget, "status" | "total_price" | "is_deposit_paid">,
  paymentEvents: Array<{ id: string; status: string }>,
  options: { paymentEventId?: string; manualApproval?: boolean } = {}
): boolean {
  const totalPrice = Number(reservation.total_price);
  const depositAmount = getDepositAmount(totalPrice);
  const hasPendingReview = paymentEvents.some((event) => event.status === "pending_review");
  const hasApprovedEvent = paymentEvents.some((event) => event.status === "approved");
  const requestedEventApproved = options.paymentEventId
    ? paymentEvents.some(
        (event) => event.id === options.paymentEventId && event.status === "approved"
      )
    : true;
  const hasUnapprovedEventHistory = paymentEvents.length > 0 && !hasApprovedEvent;

  return (
    reservation.status === "confirmed" &&
    reservation.is_deposit_paid &&
    Number.isFinite(totalPrice) &&
    depositAmount > 0 &&
    !hasPendingReview &&
    requestedEventApproved &&
    (!hasUnapprovedEventHistory || Boolean(options.manualApproval))
  );
}

export type NotifyPaymentApprovedOptions = {
  actor?: string;
  reviewNote?: string | null;
  force?: boolean;
  paymentEventId?: string;
  manualApproval?: boolean;
  operatorConfirmedSafeRetry?: boolean;
  reconciliationApprovedRetry?: boolean;
  client?: SupabaseClient;
};

export async function notifyPaymentApproved(
  reservationId: string,
  opts: NotifyPaymentApprovedOptions = {}
): Promise<NotifyPaymentApprovedResult> {
  if (!reservationId || typeof reservationId !== "string") {
    return { ok: false, error: "invalid_reservation_id" };
  }

  // 1. In-memory lock to prevent concurrent races within the same Node isolate
  if (!opts.force && inFlightSends.has(reservationId)) {
    return { ok: true, already_notified: true };
  }
  inFlightSends.add(reservationId);

  const client = opts.client ?? defaultClient();
  const nowIso = new Date().toISOString();
  const isAuthorizedReconciliationRetry = Boolean(
    opts.operatorConfirmedSafeRetry || opts.reconciliationApprovedRetry
  );

  try {
    if (!isAdminConfigured()) {
      return { ok: false, error: "admin_unconfigured" };
    }

    let r: ReservationNotifyTarget | null = null;
    let fallbackToLegacy = false;

    // 2. Fetch current reservation record
    let existing: ReservationNotifyTarget | null = null;
    try {
      const { data, error: fetchErr } = await client
        .from("reservations")
        .select(
          "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, status, total_price, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at, deposit_approved_retry_key, deposit_approved_guest_retry_key, deposit_approved_retry_key_created_at"
        )
        .eq("id", reservationId)
        .maybeSingle();

      if (fetchErr) {
        if (/42703|deposit_approved_retry_key/i.test(fetchErr.message ?? "")) {
          fallbackToLegacy = true;
        } else {
          return { ok: false, error: "reservation_not_found" };
        }
      } else {
        existing = data as ReservationNotifyTarget | null;
      }
    } catch {
      fallbackToLegacy = true;
    }

    if (fallbackToLegacy || !existing) {
      const { data: legacyData, error: legacyErr } = await client
        .from("reservations")
        .select(
          "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, status, total_price, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at"
        )
        .eq("id", reservationId)
        .maybeSingle();

      if (legacyErr || !legacyData) {
        return { ok: false, error: "reservation_not_found" };
      }
      existing = legacyData as ReservationNotifyTarget;
    }

    const { data: paymentEvents, error: pendingReviewError } = await client
      .from("payment_events")
      .select("id, status")
      .eq("reservation_id", reservationId);

    if (pendingReviewError) {
      console.error("[payment-notify] payment review eligibility check failed:", pendingReviewError.message);
      return { ok: false, error: "payment_state_unavailable" };
    }

    const currentPaymentEvents = (paymentEvents ?? []) as Array<{ id: string; status: string }>;
    if (
      !isDepositApprovalNotificationEligible(existing, currentPaymentEvents, {
        paymentEventId: opts.paymentEventId,
        manualApproval: opts.manualApproval,
      })
    ) {
      if (currentPaymentEvents.some((event) => event.status === "pending_review")) {
        return { ok: false, error: "payment_pending_review" };
      }
      if (
        opts.paymentEventId &&
        !currentPaymentEvents.some(
          (event) => event.id === opts.paymentEventId && event.status === "approved"
        )
      ) {
        return { ok: false, error: "payment_not_approved" };
      }
      if (currentPaymentEvents.length && !currentPaymentEvents.some((event) => event.status === "approved") && !opts.manualApproval) {
        return { ok: false, error: "payment_not_approved" };
      }
      if (existing.status !== "confirmed") {
        return { ok: false, error: "reservation_not_confirmed" };
      }
      if (!existing.is_deposit_paid) return { ok: false, error: "deposit_not_paid" };
      return { ok: false, error: "no_valid_deposit" };
    }
    if (!opts.force && existing.deposit_approved_notified_at) {
      return { ok: true, already_notified: true };
    }

    // Check active claim lease
    if (
      !opts.force &&
      existing.deposit_approved_claim_at &&
      new Date(existing.deposit_approved_claim_at).getTime() >= Date.now() - DISPATCH_CLAIM_LEASE_MS
    ) {
      // Another instance is currently dispatching
      return { ok: true, already_notified: false };
    }

    // 3. Resolve stable retry keys and enforce >24h provider attempt safeguard
    const hasExistingKey = Boolean(existing.deposit_approved_retry_key);
    const isKeyExpired =
      hasExistingKey &&
      isLineRetryKeyExpired(existing.deposit_approved_retry_key_created_at);

    let groupRetryKey: string;
    let guestRetryKey: string;
    let retryKeyCreatedAt: string;

    if (!hasExistingKey) {
      // Fresh key creation before any provider attempt:
      // No key was ever allocated or dispatched, proving no provider request was ever attempted.
      groupRetryKey = crypto.randomUUID();
      guestRetryKey = crypto.randomUUID();
      retryKeyCreatedAt = nowIso;
    } else if (!isKeyExpired) {
      // Within LINE's 24h retention window:
      // Reuse the exact same stable UUIDs across timeout, 5xx, or lease expiration!
      // If LINE already accepted it, LINE returns 409 Conflict which is reconciled as accepted.
      groupRetryKey = existing.deposit_approved_retry_key!;
      guestRetryKey = existing.deposit_approved_guest_retry_key || crypto.randomUUID();
      retryKeyCreatedAt = existing.deposit_approved_retry_key_created_at || nowIso;
    } else {
      // Key exists but is expired (>24h).
      // If any provider request with the previous key may have been attempted/accepted:
      // that state is ambiguous. Automatic delivery must stop and enter reconciliation_required / manual-review.
      if (!isAuthorizedReconciliationRetry) {
        // Log warning and record reconciliation_required event in ops_events
        try {
          await client.from("ops_events").insert({
            domain: "payment",
            action: "payment.approved_notification_reconciliation_required",
            detail: {
              reservation_id: reservationId,
              booking_code: existing.booking_code,
              group_retry_key: existing.deposit_approved_retry_key,
              guest_retry_key: existing.deposit_approved_guest_retry_key ?? null,
              retry_key_created_at: existing.deposit_approved_retry_key_created_at,
              reason: "retry_key_expired_with_possible_provider_attempt",
              actor: opts.actor ?? "system",
            },
          });
        } catch (opsErr) {
          console.warn("[payment-notify] ops_events reconciliation_required insert notice:", opsErr);
        }

        // Best-effort staff LINE alert through existing staff group push mechanism
        if (isLineConfigured()) {
          try {
            await sendLineMessage(
              formatReconciliationRequiredAlert({
                reservationId,
                bookingCode: existing.booking_code,
                customerName: existing.customer_name,
                groupRetryKey: existing.deposit_approved_retry_key ?? null,
                retryKeyCreatedAt: existing.deposit_approved_retry_key_created_at ?? null,
              })
            );
          } catch (alertErr) {
            console.warn("[payment-notify] staff LINE alert notice:", alertErr);
          }
        }

        console.warn(
          `[payment-notify] Stop automatic delivery: reservation ${reservationId} has expired LINE retryKey (${existing.deposit_approved_retry_key}) with potential prior provider attempt. Entering reconciliation_required.`
        );

        return {
          ok: false,
          error: "reconciliation_required",
          reconciliation_required: true,
          reason:
            "LINE 24h retry window expired with potential prior provider attempt; manual reconciliation required",
          group_retry_key: existing.deposit_approved_retry_key ?? undefined,
          guest_retry_key: existing.deposit_approved_guest_retry_key ?? undefined,
        };
      }

      // Explicit operator reconciliation authorization provided (operatorConfirmedSafeRetry / reconciliationApprovedRetry).
      // A new retry key may only be minted through this explicit reconciliation authorization path.
      // Note: Human inspection of LINE OA / staff group does NOT prove that no provider attempt occurred;
      // it represents deliberate operator authorization to mint a fresh key and proceed.
      groupRetryKey = crypto.randomUUID();
      guestRetryKey = crypto.randomUUID();
      retryKeyCreatedAt = nowIso;
    }

    // 4. DB-level atomic lease claim (CAS)
    if (!opts.force) {
      try {
        const updatePayload: Record<string, unknown> = {
          deposit_approved_claim_at: nowIso,
        };
        if (!fallbackToLegacy) {
          updatePayload.deposit_approved_retry_key = groupRetryKey;
          updatePayload.deposit_approved_guest_retry_key = guestRetryKey;
          updatePayload.deposit_approved_retry_key_created_at = retryKeyCreatedAt;
        }

        let claimQuery = client
          .from("reservations")
          .update(updatePayload)
          .eq("id", reservationId)
          .eq("status", "confirmed")
          .eq("is_deposit_paid", true)
          .gt("total_price", 0)
          .is("deposit_approved_notified_at", null);

        if (existing.deposit_approved_claim_at) {
          claimQuery = claimQuery.eq("deposit_approved_claim_at", existing.deposit_approved_claim_at);
        } else {
          claimQuery = claimQuery.is("deposit_approved_claim_at", null);
        }

        const claimRes = await claimQuery
          .select(
            "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at, deposit_approved_retry_key, deposit_approved_guest_retry_key, deposit_approved_retry_key_created_at"
          )
          .maybeSingle();

        if (claimRes.error) {
          // A claim error leaves ownership unknown. Sending anyway would let
          // two serverless instances dispatch the same logical notification.
          console.error("[payment-notify] atomic claim failed:", claimRes.error.message);
          return { ok: false, error: "notification_claim_failed" };
        }

        if (claimRes.data) {
          r = claimRes.data as ReservationNotifyTarget;
        } else {
          // Concurrent race: another instance acquired the claim before us
          return { ok: true, already_notified: false };
        }
      } catch (claimErr) {
        // A claim error leaves ownership unknown. Fail closed so a transient
        // database failure cannot turn into a duplicate provider request.
        console.error(
          "[payment-notify] atomic claim failed:",
          claimErr instanceof Error ? claimErr.message : String(claimErr)
        );
        return { ok: false, error: "notification_claim_failed" };
      }
    }

    if (!r) {
      r = {
        ...existing,
        deposit_approved_retry_key: groupRetryKey,
        deposit_approved_guest_retry_key: guestRetryKey,
        deposit_approved_retry_key_created_at: retryKeyCreatedAt,
      };
    }

    const effectiveGroupKey = r.deposit_approved_retry_key ?? groupRetryKey;
    const effectiveGuestKey = r.deposit_approved_guest_retry_key ?? guestRetryKey;

    let groupNotified = false;
    let guestNotified = false;
    let lastSendError: unknown = null;

    // Record provider attempt in ops_events for auditability and attempt evidence
    try {
      await client.from("ops_events").insert({
        domain: "payment",
        action: "payment.approved_attempt",
        detail: {
          reservation_id: reservationId,
          booking_code: r.booking_code,
          group_retry_key: effectiveGroupKey,
          guest_retry_key: r.line_user_id ? effectiveGuestKey : null,
          line_user_id: r.line_user_id ?? null,
          is_operator_authorized_retry: isAuthorizedReconciliationRetry ? true : undefined,
          actor: opts.actor ?? "system",
          attempted_at: nowIso,
        },
      });
    } catch (attemptErr) {
      console.warn("[payment-notify] ops_events attempt insert notice:", attemptErr);
    }

    // 5. Staff group notification with X-Line-Retry-Key
    try {
      const flex = buildPaymentConfirmedFlex({
        customerName: r.customer_name,
        bookingCode: r.booking_code,
        startTime: r.start_time,
        endTime: r.end_time,
        rawText: opts.reviewNote?.trim() || r.deposit_payment_note || "已核准",
      });
      await sendLineFlexToBranchGroup(`💰 客人已付訂金：${r.customer_name}`, flex, await branchLineGroupIdForReservation(client, reservationId), {
        retryKey: effectiveGroupKey,
      });
      groupNotified = true;
    } catch (notifyErr) {
      lastSendError = notifyErr;
      console.error("[payment-notify] group notify failed:", notifyErr);
    }

    // 6. Guest personal notification with X-Line-Retry-Key (if bound)
    if (r.line_user_id) {
      try {
        const lookupToken = signLookupToken(r.id);
        await sendLineFlexMessage(
          r.line_user_id,
          "訂金已確認",
          buildGuestPaymentApprovedFlex({
            customerName: r.customer_name,
            bookingCode: r.booking_code,
            startTime: r.start_time,
            endTime: r.end_time,
            lookupToken,
          }),
          { retryKey: effectiveGuestKey, reservationId }
        );
        guestNotified = true;
      } catch (guestErr) {
        if (!lastSendError) lastSendError = guestErr;
        console.error("[payment-notify] guest notify failed:", guestErr);
      }
    }

    // The group and guest pushes are separate recipients of the same logical
    // approval event. Resolve the event only after every required recipient is
    // accepted. Retries reuse each recipient's stable retry key, so a push
    // that already succeeded is reconciled by LINE while the failed recipient
    // gets another delivery attempt.
    // A missing guest binding is not a successful guest notification. The
    // staff group may have received its copy, but the reservation must remain
    // retryable and the UI must not report the guest message as sent.
    const confirmedAccepted = groupNotified && Boolean(r.line_user_id) && guestNotified;

    if (confirmedAccepted) {
      // 7a. Confirmed accepted by LINE Platform! Permanently record notified timestamp and release claim lease.
      // Note: Per official LINE Messaging API documentation, HTTP 2xx and 409+x-line-accepted-request-id
      // signify "accepted by LINE Platform" for processing/delivery, not guaranteed delivered to end-user device.
      try {
        await client
          .from("reservations")
          .update({
            deposit_approved_notified_at: nowIso,
            deposit_approved_claim_at: null,
          })
          .eq("id", reservationId);
      } catch (updateErr) {
        console.warn("[payment-notify] failed to update deposit_approved_notified_at:", updateErr);
      }

      // 7b. Record in ops_events for audit & unique constraint protection
      try {
        await client.from("ops_events").insert({
          domain: "payment",
          action: "payment.approved_notified",
          detail: {
            reservation_id: reservationId,
            booking_code: r.booking_code,
            group_retry_key: effectiveGroupKey,
            guest_retry_key: r.line_user_id ? effectiveGuestKey : null,
            guest_notified: guestNotified,
            group_notified: groupNotified,
            accepted_by_platform: true,
            line_user_id: r.line_user_id ?? null,
            actor: opts.actor ?? "system",
            sent_at: nowIso,
          },
        });
      } catch (eventErr) {
        console.warn("[payment-notify] ops_events insert notice:", eventErr);
      }

      return {
        ok: true,
        accepted_by_platform: true,
        guest_notified: guestNotified,
        group_notified: groupNotified,
        group_retry_key: effectiveGroupKey,
        guest_retry_key: r.line_user_id ? effectiveGuestKey : undefined,
      };
    } else {
      // 7c. Send failed (transient error / network down / LINE API 5xx)!
      // Release claim lease immediately so subsequent retries can proceed without waiting for lease timeout.
      // Do NOT stamp deposit_approved_notified_at!
      // Do NOT clear deposit_approved_retry_key!
      try {
        await client
          .from("reservations")
          .update({ deposit_approved_claim_at: null })
          .eq("id", reservationId)
          .is("deposit_approved_notified_at", null);
      } catch (releaseErr) {
        console.warn("[payment-notify] failed to release claim lease on error:", releaseErr);
      }

      return {
        ok: false,
        error: r.line_user_id
          ? lastSendError instanceof Error ? lastSendError.message : "line_send_failed"
          : "no_line_id",
        accepted_by_platform: groupNotified || guestNotified,
        guest_notified: guestNotified,
        group_notified: groupNotified,
        group_retry_key: effectiveGroupKey,
        guest_retry_key: r.line_user_id ? effectiveGuestKey : undefined,
      };
    }
  } catch (err) {
    // Release claim on unexpected process error, preserving retry keys
    try {
      await client
        .from("reservations")
        .update({ deposit_approved_claim_at: null })
        .eq("id", reservationId)
        .is("deposit_approved_notified_at", null);
    } catch {}
    throw err;
  } finally {
    inFlightSends.delete(reservationId);
  }
}

/** Reset in-memory lock for testing */
export function __resetPaymentNotifyInFlightForTests(): void {
  inFlightSends.clear();
}

export type ReconciliationVerificationResult = {
  ok: boolean;
  reservation?: ReservationNotifyTarget;
  error?: string;
  reason?: string;
};

export async function verifyReconciliationRequired(
  reservationId: string,
  client: SupabaseClient = defaultClient()
): Promise<ReconciliationVerificationResult> {
  if (!reservationId || typeof reservationId !== "string") {
    return {
      ok: false,
      error: "invalid_reservation_id",
      reason: "Reservation ID must be a non-empty string",
    };
  }

  const { data, error: fetchErr } = await client
    .from("reservations")
    .select(
      "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at, deposit_approved_retry_key, deposit_approved_guest_retry_key, deposit_approved_retry_key_created_at"
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (fetchErr || !data) {
    return {
      ok: false,
      error: "reservation_not_found",
      reason: `Reservation ${reservationId} not found in database`,
    };
  }

  const reservation = data as ReservationNotifyTarget;

  if (!reservation.is_deposit_paid) {
    return {
      ok: false,
      error: "deposit_not_paid",
      reason: `Reservation ${reservation.booking_code} deposit is not marked paid`,
      reservation,
    };
  }

  if (reservation.deposit_approved_notified_at) {
    return {
      ok: false,
      error: "already_resolved",
      reason: `Reservation ${reservation.booking_code} notification is already resolved (notified at ${reservation.deposit_approved_notified_at})`,
      reservation,
    };
  }

  if (!reservation.deposit_approved_retry_key) {
    return {
      ok: false,
      error: "no_prior_retry_key",
      reason: `Reservation ${reservation.booking_code} has no previous retry key; standard first-send notification path applies`,
      reservation,
    };
  }

  if (!isLineRetryKeyExpired(reservation.deposit_approved_retry_key_created_at)) {
    return {
      ok: false,
      error: "retry_key_still_valid_within_24h",
      reason: `Reservation ${reservation.booking_code} retry key is still within the 24h retention window; manual reconciliation is not required`,
      reservation,
    };
  }

  return {
    ok: true,
    reservation,
  };
}

export type ReconcilePaymentNotificationResult = {
  ok: boolean;
  method?: "mark_sent" | "safe_retry";
  reservation_id?: string;
  booking_code?: string;
  notified_at?: string | null;
  notify_result?: NotifyPaymentApprovedResult;
  error?: string;
  reason?: string;
};

export type ReconcileMarkSentOptions = {
  actor?: string;
  evidenceChecked?: string;
  reason?: string;
  client?: SupabaseClient;
};

export async function reconcilePaymentNotificationMarkSent(
  reservationId: string,
  opts: ReconcileMarkSentOptions = {}
): Promise<ReconcilePaymentNotificationResult> {
  const client = opts.client ?? defaultClient();
  const verify = await verifyReconciliationRequired(reservationId, client);
  if (!verify.ok || !verify.reservation) {
    return {
      ok: false,
      method: "mark_sent",
      error: verify.error || "verification_failed",
      reason: verify.reason || "Failed verification",
      reservation_id: reservationId,
      booking_code: verify.reservation?.booking_code,
    };
  }

  const nowIso = new Date().toISOString();
  const reservation = verify.reservation;

  // Mark canonical notification state resolved without sending LINE
  const { error: updateErr } = await client
    .from("reservations")
    .update({
      deposit_approved_notified_at: nowIso,
      deposit_approved_claim_at: null,
    })
    .eq("id", reservationId)
    .is("deposit_approved_notified_at", null);

  if (updateErr) {
    return {
      ok: false,
      method: "mark_sent",
      error: "db_update_failed",
      reason: updateErr.message,
      reservation_id: reservationId,
      booking_code: reservation.booking_code,
    };
  }

  // Record audit event in ops_events
  // Audit contract: actor, timestamp, reservation ID, reconciliation reason/evidence checked,
  // prior retry identity where available, and resolution outcome.
  try {
    await client.from("ops_events").insert({
      domain: "payment",
      action: "payment.approved_notification_reconciled",
      detail: {
        actor: opts.actor ?? "operator_cli",
        timestamp: nowIso,
        reservation_id: reservationId,
        booking_code: reservation.booking_code,
        method: "mark_sent",
        authorization: "operator_confirmed_mark_sent",
        reconciliation_reason: opts.reason ?? "retry_key_expired_with_possible_provider_attempt",
        evidence_checked: opts.evidenceChecked ?? "line_oa_or_staff_group_delivery_confirmed",
        prior_retry_identity: {
          group_retry_key: reservation.deposit_approved_retry_key,
          guest_retry_key: reservation.deposit_approved_guest_retry_key ?? null,
          created_at: reservation.deposit_approved_retry_key_created_at ?? null,
        },
        resolution_outcome: {
          outcome: "marked_resolved_without_resending",
          notified_at: nowIso,
        },
        // Flat legacy fields for backward-compatible queries
        prior_retry_key: reservation.deposit_approved_retry_key,
        prior_retry_key_created_at: reservation.deposit_approved_retry_key_created_at,
        note: "Operator verified prior LINE delivery in staff group or LINE OA; marked resolved without sending LINE",
      },
    });
  } catch (eventErr) {
    console.warn("[payment-notify-reconcile] ops_events insert notice:", eventErr);
  }

  return {
    ok: true,
    method: "mark_sent",
    reservation_id: reservationId,
    booking_code: reservation.booking_code,
    notified_at: nowIso,
  };
}

export type ReconcileSafeRetryOptions = {
  actor?: string;
  evidenceChecked?: string;
  reason?: string;
  client?: SupabaseClient;
};

export async function reconcilePaymentNotificationSafeRetry(
  reservationId: string,
  opts: ReconcileSafeRetryOptions = {}
): Promise<ReconcilePaymentNotificationResult> {
  const client = opts.client ?? defaultClient();
  const verify = await verifyReconciliationRequired(reservationId, client);
  if (!verify.ok || !verify.reservation) {
    return {
      ok: false,
      method: "safe_retry",
      error: verify.error || "verification_failed",
      reason: verify.reason || "Failed verification",
      reservation_id: reservationId,
      booking_code: verify.reservation?.booking_code,
    };
  }

  const reservation = verify.reservation;

  // Invoke existing application notification path with explicit operatorConfirmedSafeRetry=true.
  // Note: Does NOT manually null/reset retry-key fields in DB to bypass idempotency!
  // Note: Human inspection of LINE OA/staff group does NOT prove that no provider attempt occurred;
  // it represents deliberate operator authorization to mint a fresh key and proceed.
  const notifyResult = await notifyPaymentApproved(reservationId, {
    actor: opts.actor ?? "operator_cli",
    operatorConfirmedSafeRetry: true,
    client,
  });

  const nowIso = new Date().toISOString();

  // Record audit event in ops_events
  // Audit contract: actor, timestamp, reservation ID, reconciliation reason/evidence checked,
  // prior retry identity where available, and resolution outcome.
  try {
    await client.from("ops_events").insert({
      domain: "payment",
      action: "payment.approved_notification_reconciled",
      detail: {
        actor: opts.actor ?? "operator_cli",
        timestamp: nowIso,
        reservation_id: reservationId,
        booking_code: reservation.booking_code,
        method: "safe_retry",
        authorization: "operator_confirmed_safe_retry",
        reconciliation_reason: opts.reason ?? "retry_key_expired_with_possible_provider_attempt",
        evidence_checked: opts.evidenceChecked ?? "line_oa_and_staff_group_inspected_no_visible_message",
        prior_retry_identity: {
          group_retry_key: reservation.deposit_approved_retry_key,
          guest_retry_key: reservation.deposit_approved_guest_retry_key ?? null,
          created_at: reservation.deposit_approved_retry_key_created_at ?? null,
        },
        resolution_outcome: {
          outcome: notifyResult.ok ? "authorized_retry_accepted" : "authorized_retry_failed",
          success: notifyResult.ok,
          group_notified: notifyResult.group_notified ?? false,
          guest_notified: notifyResult.guest_notified ?? false,
          accepted_by_platform: notifyResult.accepted_by_platform ?? false,
          error: notifyResult.error,
        },
        new_retry_identity: {
          group_retry_key: notifyResult.group_retry_key,
          guest_retry_key: notifyResult.guest_retry_key,
        },
        // Flat legacy fields for backward-compatible queries
        prior_retry_key: reservation.deposit_approved_retry_key,
        prior_retry_key_created_at: reservation.deposit_approved_retry_key_created_at,
        notify_result: notifyResult,
        note: "Operator authorized safe retry after checking LINE OA and staff group; dispatched with fresh retry key",
      },
    });
  } catch (eventErr) {
    console.warn("[payment-notify-reconcile] ops_events insert notice:", eventErr);
  }

  if (!notifyResult.ok) {
    return {
      ok: false,
      method: "safe_retry",
      error: notifyResult.error || "notify_dispatch_failed",
      reason: notifyResult.reason || "Dispatch failed during safe retry",
      reservation_id: reservationId,
      booking_code: reservation.booking_code,
      notify_result: notifyResult,
    };
  }

  return {
    ok: true,
    method: "safe_retry",
    reservation_id: reservationId,
    booking_code: reservation.booking_code,
    notify_result: notifyResult,
  };
}
