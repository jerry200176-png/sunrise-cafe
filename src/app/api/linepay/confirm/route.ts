import { NextRequest, NextResponse } from "next/server";
import { buildPaymentConfirmedFlex, sendLineFlex } from "@/lib/line-notify";
import { confirmLinePayPayment } from "@/lib/line-pay";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { logPayment } from "@/lib/payment-log";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirect(code: string, status: string): NextResponse {
  const url = new URL(`${LINE_SITE_URL}/book/query`);
  url.searchParams.set("code", code);
  url.searchParams.set("linepay", status);
  return NextResponse.redirect(url);
}

/** LINE Pay redirect callback: confirm the provider transaction and mark the reservation paid. */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const transactionId = request.nextUrl.searchParams.get("transactionId")?.trim() ?? "";
  if (!orderId || !transactionId) {
    return NextResponse.json({ error: "缺少 LINE Pay 交易資訊" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: payment, error: paymentError } = await db
    .from("line_pay_payments")
    .select("id, reservation_id, order_id, transaction_id, amount, currency, status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (paymentError) return NextResponse.json({ error: "付款紀錄查詢失敗" }, { status: 503 });
  if (!payment) return NextResponse.json({ error: "找不到付款紀錄" }, { status: 404 });
  if (payment.transaction_id && String(payment.transaction_id) !== transactionId) {
    return NextResponse.json({ error: "交易資訊不一致" }, { status: 400 });
  }

  const { data: reservation, error: reservationError } = await db
    .from("reservations")
    .select("id, customer_name, booking_code, start_time, end_time, is_deposit_paid")
    .eq("id", payment.reservation_id)
    .single();
  if (reservationError || !reservation) return NextResponse.json({ error: "找不到訂位" }, { status: 404 });

  if (payment.status === "cancelled" || payment.status === "expired" || payment.status === "failed") {
    return redirect(reservation.booking_code, "failed");
  }

  if (payment.status !== "paid") {
    try {
      const confirmed = await confirmLinePayPayment(
        transactionId,
        Number(payment.amount),
        "TWD"
      );
      const { data: updatedPayment, error: updatePaymentError } = await db
        .from("line_pay_payments")
        .update({
          status: "paid",
          transaction_id: transactionId,
          confirmed_at: new Date().toISOString(),
          response_payload: confirmed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updatePaymentError) throw updatePaymentError;
      if (!updatedPayment) {
        const { data: currentPayment, error: currentPaymentError } = await db
          .from("line_pay_payments")
          .select("status")
          .eq("id", payment.id)
          .single();
        if (currentPaymentError || currentPayment?.status !== "paid") {
          throw new Error("付款狀態更新競爭，請稍後重試");
        }
        return redirect(reservation.booking_code, "success");
      }

      const { error: updateReservationError } = await db
        .from("reservations")
        .update({
          is_deposit_paid: true,
          deposit_status: "paid",
          deposit_payment_note: `LINE Pay 自動確認（交易序號：${transactionId}）`,
        })
        .eq("id", reservation.id);
      if (updateReservationError) throw updateReservationError;

      logPayment("linepay.confirmed", {
        reservation_id: reservation.id,
        booking_code: reservation.booking_code,
        order_id: orderId,
        transaction_id: transactionId,
        amount: payment.amount,
      });

      try {
        await sendLineFlex(
          `💰 LINE Pay 已收款：${reservation.customer_name}`,
          buildPaymentConfirmedFlex({
            customerName: reservation.customer_name,
            bookingCode: reservation.booking_code,
            startTime: reservation.start_time,
            endTime: reservation.end_time,
            rawText: `LINE Pay 自動確認 · NT$ ${payment.amount}`,
          })
        );
      } catch (notifyError) {
        console.error("[linepay/confirm] group notify failed:", notifyError);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "LINE Pay 確認失敗";
      logPayment("linepay.confirm_failed", {
        reservation_id: reservation.id,
        booking_code: reservation.booking_code,
        order_id: orderId,
        transaction_id: transactionId,
        error: message,
      });
      return redirect(reservation.booking_code, "failed");
    }
  }

  return redirect(reservation.booking_code, "success");
}
