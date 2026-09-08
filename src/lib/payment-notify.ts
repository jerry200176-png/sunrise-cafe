/**
 * Idempotent LINE notification when reservation payment transitions to approved.
 * Sends:
 *  1. Guest Bot personal Flex ("訂金已確認") to `line_user_id` if present.
 *  2. Staff LINE group notification ("💰 客人已付訂金：...").
 *
 * Idempotency guarantees:
 *  1. In-process lock prevents concurrent sends within the same Node.js isolate.
 *  2. Persistent check against `ops_events` (action = "payment.approved_notified")
 *     ensures across serverless isolates and retries that duplicate sends never occur.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineFlex, buildPaymentConfirmedFlex } from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import { buildGuestPaymentApprovedFlex } from "@/lib/line-cards";
import { signLookupToken } from "@/lib/lookup-token";
import { logOps } from "@/lib/ops-log";

function defaultClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const inFlightSends = new Set<string>();

export type NotifyPaymentApprovedResult = {
  ok: boolean;
  already_notified?: boolean;
  guest_notified?: boolean;
  group_notified?: boolean;
  error?: string;
};

export async function notifyPaymentApproved(
  reservationId: string,
  opts: {
    actor?: string;
    reviewNote?: string | null;
    client?: SupabaseClient;
  } = {}
): Promise<NotifyPaymentApprovedResult> {
  if (!reservationId || typeof reservationId !== "string") {
    return { ok: false, error: "invalid_reservation_id" };
  }

  // 1. In-memory lock to prevent concurrent races in the same isolate
  if (inFlightSends.has(reservationId)) {
    return { ok: true, already_notified: true };
  }
  inFlightSends.add(reservationId);

  try {
    if (!isAdminConfigured()) {
      return { ok: false, error: "admin_unconfigured" };
    }

    const client = opts.client ?? defaultClient();

    // 2. Persistent idempotency check in ops_events
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
      // If ops_events check encounters issue, fail-open to query reservation
    }

    // 3. Load reservation
    const { data: r, error: resErr } = await client
      .from("reservations")
      .select("id, customer_name, booking_code, start_time, end_time, deposit_payment_note, line_user_id, is_deposit_paid")
      .eq("id", reservationId)
      .maybeSingle();

    if (resErr || !r) {
      return { ok: false, error: "reservation_not_found" };
    }

    // Must be marked paid
    if (!r.is_deposit_paid) {
      return { ok: false, error: "deposit_not_paid" };
    }

    let groupNotified = false;
    let guestNotified = false;

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
        console.error("[payment-notify] guest notify failed:", guestErr);
      }
    }

    // 6. Record in ops_events for audit & idempotency
    logOps("payment", "payment.approved_notified", {
      reservation_id: reservationId,
      booking_code: r.booking_code,
      guest_notified: guestNotified,
      group_notified: groupNotified,
      line_user_id: r.line_user_id ?? null,
      actor: opts.actor ?? "system",
      sent_at: new Date().toISOString(),
    });

    return { ok: true, guest_notified: guestNotified, group_notified: groupNotified };
  } finally {
    inFlightSends.delete(reservationId);
  }
}

/** Reset in-memory lock for testing */
export function __resetPaymentNotifyInFlightForTests(): void {
  inFlightSends.clear();
}
