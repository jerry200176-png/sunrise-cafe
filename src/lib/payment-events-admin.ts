/**
 * payment_events 後台審核（#56）
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logPayment, logDepositStatusChange } from "@/lib/payment-log";

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
  deposit_amount: number | null;
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

export async function fetchPendingPaymentEvents(): Promise<PendingPaymentEvent[]> {
  const { data: events, error } = await admin()
    .from("payment_events")
    .select("id, reservation_id, source, status, raw_payload, created_at")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!events?.length) return [];

  const resIds = [...new Set(events.map((e) => e.reservation_id))];
  const { data: reservations, error: resErr } = await admin()
    .from("reservations")
    .select("id, booking_code, customer_name, phone, start_time, end_time, total_price, is_deposit_paid")
    .in("id", resIds);
  if (resErr) throw resErr;

  const byId = new Map((reservations ?? []).map((r) => [r.id, r]));

  return events
    .map((e) => {
      const r = byId.get(e.reservation_id);
      if (!r) return null;
      const total = r.total_price != null ? Number(r.total_price) : null;
      const deposit_amount =
        total != null ? Math.ceil(total / 2) : null;
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
        deposit_amount,
      };
    })
    .filter((x): x is PendingPaymentEvent => x != null);
}

export type ApprovePaymentResult = { already_processed: boolean };
export type RejectPaymentResult = { already_processed: boolean };

export async function approvePaymentEvent(
  eventId: string,
  reviewNote?: string | null
): Promise<ApprovePaymentResult> {
  const { data: event, error: fetchErr } = await admin()
    .from("payment_events")
    .select("id, reservation_id, status, raw_payload")
    .eq("id", eventId)
    .single();
  if (fetchErr || !event) throw new Error("找不到付款事件");
  if (event.status === "approved") return { already_processed: true };
  if (event.status !== "pending_review") throw new Error("此事件已駁回，無法核准");

  const { data: beforeRes, error: beforeErr } = await admin()
    .from("reservations")
    .select("is_deposit_paid, deposit_payment_note, status, booking_code")
    .eq("id", event.reservation_id)
    .single();
  if (beforeErr || !beforeRes) throw new Error("找不到訂位");

  const now = new Date().toISOString();
  const note =
    reviewNote?.trim() ||
    event.raw_payload ||
    "後台核准";

  const { error: resErr } = await admin()
    .from("reservations")
    .update({
      is_deposit_paid: true,
      deposit_payment_note: note,
    })
    .eq("id", event.reservation_id);
  if (resErr) throw resErr;

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

  if (!beforeRes.is_deposit_paid) {
    logDepositStatusChange({
      action: "deposit.marked_paid",
      reservation_id: event.reservation_id,
      booking_code: beforeRes.booking_code,
      actor_type: "admin_payment_review",
      payment_event_id: eventId,
      before: {
        is_deposit_paid: beforeRes.is_deposit_paid,
        deposit_payment_note: beforeRes.deposit_payment_note,
        status: beforeRes.status,
      },
      after: {
        is_deposit_paid: true,
        deposit_payment_note: note,
        status: beforeRes.status,
      },
    });
  }

  return { already_processed: false };
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
