import { NextRequest, NextResponse } from "next/server";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { deliverLinePayNotification } from "@/lib/linepay-notification-outbox";
import { reconcileLinePayPayment, safeLinePayError } from "@/lib/linepay-lifecycle";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const url = new URL(`${LINE_SITE_URL}/book/query`);
  url.searchParams.set("linepay", "cancelled");
  if (!orderId) return NextResponse.redirect(url);

  const db = supabaseAdmin();
  const { data: payment, error } = await db
    .from("line_pay_payments")
    .select("id, reservation_id, order_id, transaction_id, amount, currency, status, confirm_started_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error || !payment) return NextResponse.redirect(url);

  const { data: reservation } = await db
    .from("reservations")
    .select("id, customer_name, booking_code, start_time, end_time, is_deposit_paid")
    .eq("id", payment.reservation_id)
    .maybeSingle();
  if (!reservation) return NextResponse.redirect(url);

  const result = await reconcileLinePayPayment(db, payment, reservation);
  if (result.status === "paid") {
    if (result.outboxId) {
      try {
        await deliverLinePayNotification(result.outboxId, db);
      } catch (notifyError) {
        console.error("[linepay] cancel notification queue error", {
          outbox_id: result.outboxId,
          error: safeLinePayError(notifyError),
        });
      }
    }
    url.searchParams.set("linepay", "success");
    url.searchParams.set("code", reservation.booking_code);
    return NextResponse.redirect(url);
  }

  if (payment.status === "paid") {
    url.searchParams.set("linepay", "success");
  } else if (["pending", "confirming"].includes(payment.status)) {
    await db.from("line_pay_payments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", payment.id)
      .in("status", ["pending", "confirming"]);
  }
  return NextResponse.redirect(url);
}
