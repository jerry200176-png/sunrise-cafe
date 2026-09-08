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
 *     `x-line-accepted-request-id`. We reconcile 409 as confirmed sent without duplicating messages.
 *  2. Stable UUID persistence:
 *     Stable UUIDs are generated on the first request and persisted to `reservations`
 *     (`deposit_approved_retry_key`, `deposit_approved_guest_retry_key`, `deposit_approved_retry_key_created_at`).
 *     The exact same keys are reused across timeout, 5xx, or lease expiration.
 *  3. DB lease expiration does NOT regenerate the retry key:
 *     When the 60s `deposit_approved_claim_at` lease expires, subsequent retries preserve the
 *     existing persisted retry keys.
 *  4. 24-hour LINE retention window constraint:
 *     Per official LINE documentation, retry keys are held by LINE for 24 hours. If retrying
 *     after 24 hours, fresh keys are minted to prevent treating an expired key as a new un-deduped request.
 *  5. Confirmed sent contract:
 *     `deposit_approved_notified_at` is stamped ONLY when LINE push is confirmed sent (200 or 409).
 *     On transient errors (5xx/timeout), the claim lease is released immediately and `deposit_approved_notified_at`
 *     remains NULL.
 *  6. Partial unique index on `ops_events`:
 *     Deduplication and audit record in `ops_events`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineFlex, buildPaymentConfirmedFlex } from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
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

export type NotifyPaymentApprovedResult = {
  ok: boolean;
  already_notified?: boolean;
  guest_notified?: boolean;
  group_notified?: boolean;
  group_retry_key?: string;
  guest_retry_key?: string;
  error?: string;
};

type ReservationNotifyTarget = {
  id: string;
  customer_name: string;
  booking_code: string;
  start_time: string;
  end_time: string;
  deposit_payment_note: string | null;
  line_user_id: string | null;
  is_deposit_paid: boolean;
  deposit_approved_notified_at?: string | null;
  deposit_approved_claim_at?: string | null;
  deposit_approved_retry_key?: string | null;
  deposit_approved_guest_retry_key?: string | null;
  deposit_approved_retry_key_created_at?: string | null;
};

export async function notifyPaymentApproved(
  reservationId: string,
  opts: {
    actor?: string;
    reviewNote?: string | null;
    force?: boolean;
    client?: SupabaseClient;
  } = {}
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
          "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at, deposit_approved_retry_key, deposit_approved_guest_retry_key, deposit_approved_retry_key_created_at"
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
          "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at"
        )
        .eq("id", reservationId)
        .maybeSingle();

      if (legacyErr || !legacyData) {
        return { ok: false, error: "reservation_not_found" };
      }
      existing = legacyData as ReservationNotifyTarget;
    }

    if (!existing.is_deposit_paid) {
      return { ok: false, error: "deposit_not_paid" };
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

    // 3. Resolve stable retry keys
    const hasValidKey =
      Boolean(existing.deposit_approved_retry_key) &&
      !isLineRetryKeyExpired(existing.deposit_approved_retry_key_created_at);

    let groupRetryKey: string;
    let guestRetryKey: string;
    let retryKeyCreatedAt: string;

    if (hasValidKey && !opts.force) {
      // Reuse the exact same stable UUIDs across timeout, 5xx, or lease expiration!
      groupRetryKey = existing.deposit_approved_retry_key!;
      guestRetryKey = existing.deposit_approved_guest_retry_key || crypto.randomUUID();
      retryKeyCreatedAt = existing.deposit_approved_retry_key_created_at || nowIso;
    } else {
      // First request OR 24h retention window expired: mint fresh stable UUIDs
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
          .eq("is_deposit_paid", true)
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

        if (!claimRes.error && claimRes.data) {
          r = claimRes.data as ReservationNotifyTarget;
        } else if (!claimRes.error && !claimRes.data) {
          // Concurrent race: another instance acquired the claim before us
          return { ok: true, already_notified: false };
        }
      } catch {
        // Fallback if atomic claim encounters error
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

    // 5. Staff group notification with X-Line-Retry-Key
    try {
      const flex = buildPaymentConfirmedFlex({
        customerName: r.customer_name,
        bookingCode: r.booking_code,
        startTime: r.start_time,
        endTime: r.end_time,
        rawText: opts.reviewNote?.trim() || r.deposit_payment_note || "已核准",
      });
      await sendLineFlex(`💰 客人已付訂金：${r.customer_name}`, flex, {
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
          { retryKey: effectiveGuestKey }
        );
        guestNotified = true;
      } catch (guestErr) {
        if (!lastSendError) lastSendError = guestErr;
        console.error("[payment-notify] guest notify failed:", guestErr);
      }
    }

    const confirmedSent = groupNotified || guestNotified;

    if (confirmedSent) {
      // 7a. Confirmed sent! Permanently record notified timestamp and release claim lease
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
        error: lastSendError instanceof Error ? lastSendError.message : "line_send_failed",
        guest_notified: false,
        group_notified: false,
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
