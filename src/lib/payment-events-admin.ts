/**
 * payment_events 後台審核（#56）
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logPayment } from "@/lib/payment-log";
import { taipeiDateString } from "@/lib/datetime";
import { markDepositPaid } from "@/lib/deposit-paid";
import { getDepositAmount } from "@/lib/booking-utils";
import type { NotifyPaymentApprovedResult } from "@/lib/payment-notify";

export type PaymentEventStatus = "pending_review" | "approved" | "rejected";

export type PendingPaymentEvent = {
  id: string;
  reservation_id: string;
  source: string;
  status: PaymentEventStatus;
  raw_payload: string | null;
  created_at: string;
  booking_code: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  total_price: number | null;
  is_deposit_paid: boolean;
  reservation_status?: string;
  deposit_amount: number | null;
  reported_account_last_five?: string | null;
  reported_amount?: number | null;
  reported_at?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  reviewed_by?: string | null;
};

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** 檢查 payment_events 表是否已 migration */
export async function isPaymentEventsTableReady(): Promise<boolean> {
  const { error } = await admin().from("payment_events").select("id").limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code;
  const msg = error.message ?? "";
  if (code === "PGRST205" || /payment_events/i.test(msg)) return false;
  throw error;
}

export async function countPendingPaymentEventsForReservation(
  reservationId: string
): Promise<number> {
  const { count, error } = await admin()
    .from("payment_events")
    .select("id", { count: "exact", head: true })
    .eq("reservation_id", reservationId)
    .eq("status", "pending_review");
  if (error) throw error;
  return count ?? 0;
}

/** Batch pending counts for admin reservation list */
export async function fetchPendingPaymentCountsByReservation(
  reservationIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!reservationIds.length) return counts;

  const ready = await isPaymentEventsTableReady();
  if (!ready) return counts;

  const { data, error } = await admin()
    .from("payment_events")
    .select("reservation_id")
    .in("reservation_id", reservationIds)
    .eq("status", "pending_review");
  if (error) throw error;

  for (const row of data ?? []) {
    const id = row.reservation_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function fetchPendingPaymentEvents(): Promise<PendingPaymentEvent[]> {
  const { data: events, error } = await admin()
    .from("payment_events")
    .select("id, reservation_id, source, status, raw_payload, created_at, reported_account_last_five, reported_amount, reported_at, created_by, updated_at, updated_by, reviewed_by")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!events?.length) return [];

  const resIds = [...new Set(events.map((e) => e.reservation_id))];
  const { data: reservations, error: resErr } = await admin()
    .from("reservations")
    .select("id, booking_code, customer_name, phone, start_time, end_time, total_price, is_deposit_paid, status")
    .in("id", resIds);
  if (resErr) throw resErr;

  const byId = new Map((reservations ?? []).map((r) => [r.id, r]));

  return events
    .map((e): PendingPaymentEvent | null => {
      const r = byId.get(e.reservation_id);
      if (!r) return null;
      const total = r.total_price != null ? Number(r.total_price) : null;
      const deposit_amount =
        total != null ? getDepositAmount(total) : null;
      return {
        id: e.id,
        reservation_id: e.reservation_id,
        source: e.source,
        status: e.status as PaymentEventStatus,
        raw_payload: e.raw_payload,
        created_at: e.created_at,
        booking_code: r.booking_code,
        customer_name: r.customer_name,
        phone: r.phone,
        start_time: r.start_time,
        end_time: r.end_time,
        total_price: total,
        is_deposit_paid: r.is_deposit_paid,
        reservation_status: r.status,
        deposit_amount,
        reported_account_last_five: e.reported_account_last_five ?? null,
        reported_amount: e.reported_amount != null ? Number(e.reported_amount) : null,
        reported_at: e.reported_at ?? null,
        created_by: e.created_by ?? null,
        updated_at: e.updated_at ?? null,
        updated_by: e.updated_by ?? null,
        reviewed_by: e.reviewed_by ?? null,
      };
    })
    .filter((x): x is PendingPaymentEvent => x != null);
}

export type ApprovePaymentResult = {
  already_processed: boolean;
  /** Approval notification outcome (null when already processed) */
  notification?: NotifyPaymentApprovedResult | null;
};
export type RejectPaymentResult = { already_processed: boolean };

export async function approvePaymentEvent(
  eventId: string,
  reviewNote?: string | null,
  actor = "admin_payment_review"
): Promise<ApprovePaymentResult> {
  const { data: event, error: fetchErr } = await admin()
    .from("payment_events")
    .select("id, reservation_id, source, status, raw_payload, reported_account_last_five, reported_at")
    .eq("id", eventId)
    .single();
  if (fetchErr || !event) throw new Error("找不到付款事件");
  if (event.status === "approved") return { already_processed: true };
  if (event.status !== "pending_review") throw new Error("此事件已駁回，無法核准");

  if (event.source === "bank_transfer") {
    const { data, error } = await admin().rpc("confirm_bank_transfer_payment", {
      p_event_id: eventId,
      p_actor: actor,
      p_review_note: reviewNote?.trim() || null,
    });
    if (error) throw new Error(error.message);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("找不到付款事件");
    if (result.outcome === "already_processed") return { already_processed: true };
    // The RPC already set is_deposit_paid and verified the last five. markDepositPaid copies the
    // reconciliation fields (report time = transfer date), audits and notifies like every other
    // paid path. A failed info write must not roll back the approval (data stays in payment_events).
    let notification: NotifyPaymentApprovedResult | null = null;
    try {
      ({ notification } = await markDepositPaid(
        result.reservation_id,
        "payment_review",
        {
          lastFive: event.reported_account_last_five,
          paidOn: event.reported_at ? taipeiDateString(new Date(event.reported_at)) : null,
          reviewNote: reviewNote?.trim() || null,
          paymentEventId: eventId,
        },
        actor
      ));
    } catch (err) {
      console.error("[payment-events] deposit transfer info write failed:", err);
    }
    logPayment("payment_event.approved", {
      event_id: eventId,
      reservation_id: result.reservation_id,
      source: "bank_transfer",
      actor,
    });
    return { already_processed: false, notification };
  }

  const { data: beforeRes, error: beforeErr } = await admin()
    .from("reservations")
    .select("id")
    .eq("id", event.reservation_id)
    .single();
  if (beforeErr || !beforeRes) throw new Error("找不到訂位");

  const now = new Date().toISOString();
  const note =
    reviewNote?.trim() ||
    event.raw_payload ||
    "後台核准";

  const { data: updated, error: evErr } = await admin()
    .from("payment_events")
    .update({
      status: "approved",
      reviewed_at: now,
      review_note: reviewNote?.trim() || null,
    })
    .eq("id", eventId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (evErr) throw evErr;
  if (!updated) return { already_processed: true };

  logPayment("payment_event.approved", {
    event_id: eventId,
    reservation_id: event.reservation_id,
  });

  const { notification } = await markDepositPaid(
    event.reservation_id,
    "payment_review",
    { note, reviewNote: reviewNote?.trim() || null, paymentEventId: eventId },
    actor
  );
  return { already_processed: false, notification };
}

export async function rejectPaymentEvent(
  eventId: string,
  reviewNote: string
): Promise<RejectPaymentResult> {
  const reason = reviewNote.trim();
  if (!reason) throw new Error("請填寫駁回原因");

  const { data: event, error: fetchErr } = await admin()
    .from("payment_events")
    .select("id, status")
    .eq("id", eventId)
    .single();
  if (fetchErr || !event) throw new Error("找不到付款事件");
  if (event.status === "rejected") return { already_processed: true };
  if (event.status !== "pending_review") throw new Error("此事件已核准，無法駁回");

  const { data: updated, error } = await admin()
    .from("payment_events")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      review_note: reason,
    })
    .eq("id", eventId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) return { already_processed: true };

  logPayment("payment_event.rejected", { event_id: eventId, reason });
  return { already_processed: false };
}
