import { NextRequest, NextResponse } from "next/server";
import { deliverLinePayNotification } from "@/lib/linepay-notification-outbox";
import { reconcileLinePayPayment, safeLinePayError } from "@/lib/linepay-lifecycle";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Read-only customer polling endpoint with provider reconciliation on unknown state. */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: payment, error } = await db
    .from("line_pay_payments")
    .select("id, reservation_id, order_id, transaction_id, amount, currency, status, confirm_started_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "payment lookup failed" }, { status: 503 });
  if (!payment) return NextResponse.json({ status: "not_found" }, { status: 404 });
  if (payment.status === "paid") return NextResponse.json({ status: "paid" });

  const { data: reservation, error: reservationError } = await db
    .from("reservations")
    .select("id, customer_name, booking_code, start_time, end_time, is_deposit_paid")
    .eq("id", payment.reservation_id)
    .maybeSingle();
  if (reservationError || !reservation) return NextResponse.json({ error: "reservation not found" }, { status: 404 });

  try {
    const result = await reconcileLinePayPayment(db, payment, reservation);
    if (result.status === "paid") {
      if (result.outboxId) {
        try {
          await deliverLinePayNotification(result.outboxId, db);
        } catch (notifyError) {
          console.error("[linepay] status notification queue error", {
            outbox_id: result.outboxId,
            error: safeLinePayError(notifyError),
          });
        }
      }
      return NextResponse.json({ status: "paid" });
    }
    return NextResponse.json({ status: result.status }, { status: result.status === "unknown" ? 202 : 200 });
  } catch (error) {
    console.error("[linepay] status reconciliation failed", { order_id: orderId, error: safeLinePayError(error) });
    return NextResponse.json({ status: "unknown" }, { status: 202 });
  }
}
