/**
 * Idempotent LINE notification when reservation payment transitions to approved.
 * Sends:
 *  1. Guest Bot personal Flex ("訂金已確認") to `line_user_id` if present.
 *  2. Staff LINE group notification ("💰 客人已付訂金：...").
 *
 * Cross-instance idempotency and fault-tolerance guarantees across Vercel serverless functions:
 *  1. DB-level atomic lease claim on `reservations.deposit_approved_claim_at`:
 *     An atomic conditional UPDATE with lease duration ensures exactly one serverless
 *     instance acquires the dispatch right; concurrent instances update 0 rows and exit.
 *  2. Only confirmed sent stamps `deposit_approved_notified_at`:
 *     `deposit_approved_notified_at` is NEVER set prior to actual send. If LINE dispatch fails
 *     or times out, the claim lease is released immediately and `deposit_approved_notified_at`
 *     remains NULL, allowing safe retries.
 *  3. Crash recovery via lease expiration (60s):
 *     If an instance terminates unexpectedly mid-dispatch, the lease expires after 60 seconds,
 *     allowing future retries to re-acquire the claim without being permanently blocked.
 *  4. Partial unique index on `ops_events ((detail->>'reservation_id')) WHERE action = 'payment.approved_notified'`:
 *     Database-level unique constraint prevents duplicate audit/dispatch records.
 *  5. In-process Set guard avoids redundant local invocations within the same Node isolate.
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

export type NotifyPaymentApprovedResult = {
  ok: boolean;
  already_notified?: boolean;
  guest_notified?: boolean;
  group_notified?: boolean;
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
    const leaseCutoff = new Date(Date.now() - DISPATCH_CLAIM_LEASE_MS).toISOString();

    // 2. DB-level atomic lease claim: conditional UPDATE with PostgreSQL row lock
    if (!opts.force) {
      try {
        const claimRes = await client
          .from("reservations")
          .update({ deposit_approved_claim_at: nowIso })
          .eq("id", reservationId)
          .eq("is_deposit_paid", true)
          .is("deposit_approved_notified_at", null)
          .or(`deposit_approved_claim_at.is.null,deposit_approved_claim_at.lt.${leaseCutoff}`)
          .select(
            "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at"
          )
          .maybeSingle();

        if (!claimRes.error) {
          if (claimRes.data) {
            // Atomic lease claim acquired!
            r = claimRes.data as ReservationNotifyTarget;
          } else {
            // Row not updated: inspect current state to return exact reason
            const { data: existing, error: fetchErr } = await client
              .from("reservations")
              .select("id, is_deposit_paid, deposit_approved_notified_at, deposit_approved_claim_at")
              .eq("id", reservationId)
              .maybeSingle();

            if (fetchErr || !existing) {
              return { ok: false, error: "reservation_not_found" };
            }
            if (!existing.is_deposit_paid) {
              return { ok: false, error: "deposit_not_paid" };
            }
            if (existing.deposit_approved_notified_at) {
              return { ok: true, already_notified: true };
            }
            if (
              existing.deposit_approved_claim_at &&
              new Date(existing.deposit_approved_claim_at).getTime() >= Date.now() - DISPATCH_CLAIM_LEASE_MS
            ) {
              // Another instance is currently in-flight dispatching
              return { ok: true, already_notified: false };
            }
            return { ok: true, already_notified: true };
          }
        }
      } catch {
        // Fallback to ops_events check if deposit_approved_claim_at column not yet applied
      }
    }

    // 3. Fallback when claim column is pending or force=true
    if (!r) {
      const { data: fetched, error: resErr } = await client
        .from("reservations")
        .select(
          "id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid, deposit_approved_notified_at"
        )
        .eq("id", reservationId)
        .maybeSingle();

      if (resErr || !fetched) {
        return { ok: false, error: "reservation_not_found" };
      }
      if (!fetched.is_deposit_paid) {
        return { ok: false, error: "deposit_not_paid" };
      }

      if (!opts.force) {
        if (fetched.deposit_approved_notified_at) {
          return { ok: true, already_notified: true };
        }
        try {
          const { data: existingEvent, error: checkErr } = await client
            .from("ops_events")
            .select("id")
            .eq("domain", "payment")
            .eq("action", "payment.approved_notified")
            .contains("detail", { reservation_id: reservationId })
            .limit(1)
            .maybeSingle();

          if (!checkErr && existingEvent) {
            return { ok: true, already_notified: true };
          }
        } catch {
          // ignore error and proceed
        }
      }

      r = fetched as ReservationNotifyTarget;
    }

    let groupNotified = false;
    let guestNotified = false;
    let lastSendError: unknown = null;

    // 4. Group notification
    try {
      const flex = buildPaymentConfirmedFlex({
        customerName: r.customer_name,
        bookingCode: r.booking_code,
        startTime: r.start_time,
        endTime: r.end_time,
        rawText: opts.reviewNote?.trim() || r.deposit_payment_note || "已核准",
      });
      await sendLineFlex(`💰 客人已付訂金：${r.customer_name}`, flex);
      groupNotified = true;
    } catch (notifyErr) {
      lastSendError = notifyErr;
      console.error("[payment-notify] group notify failed:", notifyErr);
    }

    // 5. Guest personal notification (if bound)
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
          })
        );
        guestNotified = true;
      } catch (guestErr) {
        if (!lastSendError) lastSendError = guestErr;
        console.error("[payment-notify] guest notify failed:", guestErr);
      }
    }

    const confirmedSent = groupNotified || guestNotified;

    if (confirmedSent) {
      // 6a. Confirmed sent! Permanently record notified timestamp and release claim lease
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

      // 6b. Record in ops_events for audit & unique constraint protection
      try {
        await client.from("ops_events").insert({
          domain: "payment",
          action: "payment.approved_notified",
          detail: {
            reservation_id: reservationId,
            booking_code: r.booking_code,
            guest_notified: guestNotified,
            group_notified: groupNotified,
            line_user_id: r.line_user_id ?? null,
            actor: opts.actor ?? "system",
            sent_at: nowIso,
          },
        });
      } catch (eventErr) {
        // If unique constraint error (23505), duplicate was prevented at DB level
        console.warn("[payment-notify] ops_events insert notice:", eventErr);
      }

      return { ok: true, guest_notified: guestNotified, group_notified: groupNotified };
    } else {
      // 6c. Send failed (transient error / network down / LINE API error)!
      // Release claim lease immediately so subsequent retries can proceed without waiting for lease timeout.
      // Do NOT stamp deposit_approved_notified_at!
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
      };
    }
  } catch (err) {
    // Release claim on unexpected process error
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
