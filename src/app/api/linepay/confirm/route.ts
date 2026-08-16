import { NextRequest, NextResponse } from "next/server";
import { confirmLinePayPayment } from "@/lib/line-pay";
import {
  claimPaymentConfirmation,
  finalizeLinePayPayment,
  markLinePayReconciliation,
  providerPaymentMatches,
  reconcileLinePayPayment,
  safeLinePayError,
  type LinePayPaymentRow,
  type LinePayReservationRow,
} from "@/lib/linepay-lifecycle";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { logPayment } from "@/lib/payment-log";
import { deliverLinePayNotification } from "@/lib/linepay-notification-outbox";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirect(code: string, status: "success" | "failed" | "pending"): NextResponse {
  const url = new URL(`${LINE_SITE_URL}/book/query`);
  url.searchParams.set("code", code);
  url.searchParams.set("linepay", status);
  return NextResponse.redirect(url);
}

async function loadPaymentAndReservation(db: ReturnType<typeof supabaseAdmin>, orderId: string) {
  const { data: payment, error: paymentError } = await db
    .from("line_pay_payments")
    .select("id, reservation_id, order_id, transaction_id, amount, currency, status, confirm_started_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (paymentError) return { error: NextResponse.json({ error: "payment lookup failed" }, { status: 503 }) };
  if (!payment) return { error: NextResponse.json({ error: "payment not found" }, { status: 404 }) };

  const { data: reservation, error: reservationError } = await db
    .from("reservations")
    .select("id, customer_name, booking_code, start_time, end_time, is_deposit_paid")
    .eq("id", payment.reservation_id)
    .single();
  if (reservationError || !reservation) {
    return { error: NextResponse.json({ error: "reservation not found" }, { status: 404 }) };
  }
  return { payment: payment as LinePayPaymentRow, reservation: reservation as LinePayReservationRow };
}

async function deliverNotificationSafely(
  db: ReturnType<typeof supabaseAdmin>,
  outboxId: string
) {
  try {
    await deliverLinePayNotification(outboxId, db);
  } catch (error) {
    // Payment success is not undone because a group notification is temporary work.
    console.error("[linepay] notification queue error", {
      outbox_id: outboxId,
      error: safeLinePayError(error),
    });
  }
}

/** LINE Pay redirect callback. The local claim prevents concurrent confirms. */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const transactionId = request.nextUrl.searchParams.get("transactionId")?.trim() ?? "";
  if (!orderId || !transactionId) {
    return NextResponse.json({ error: "orderId and transactionId are required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const loaded = await loadPaymentAndReservation(db, orderId);
  if (loaded.error) return loaded.error;
  const { payment, reservation } = loaded;

  if (payment.transaction_id && String(payment.transaction_id) !== transactionId) {
    return NextResponse.json({ error: "transaction does not match order" }, { status: 400 });
  }
  if (payment.status === "paid") return redirect(reservation.booking_code, "success");

  if (["cancelled", "expired", "failed"].includes(payment.status)) {
    const reconciled = await reconcileLinePayPayment(db, payment, reservation);
    if (reconciled.status === "paid") {
      if (reconciled.outboxId) await deliverNotificationSafely(db, reconciled.outboxId);
      return redirect(reservation.booking_code, "success");
    }
    return redirect(reservation.booking_code, reconciled.status === "pending" ? "pending" : "failed");
  }

  if (payment.status === "confirming") {
    // A second browser callback must never call the provider confirm concurrently.
    return redirect(reservation.booking_code, "pending");
  }

  const claim = await claimPaymentConfirmation(db, payment.id);
  if (!claim.claimed) {
    const { data: current, error } = await db
      .from("line_pay_payments")
      .select("status")
      .eq("id", payment.id)
      .single();
    if (error) return redirect(reservation.booking_code, "pending");
    if (current?.status === "paid") return redirect(reservation.booking_code, "success");
    return redirect(reservation.booking_code, "pending");
  }

  try {
    const confirmed = await confirmLinePayPayment(transactionId, Number(payment.amount), payment.currency);
    if (confirmed.returnCode !== "0000" || !providerPaymentMatches(confirmed, {
      orderId,
      transactionId,
      amount: Number(payment.amount),
    })) {
      await markLinePayReconciliation(db, payment.id, confirmed, "unknown");
      return redirect(reservation.booking_code, "pending");
    }

    const outboxId = await finalizeLinePayPayment(db, payment, reservation, confirmed, transactionId);
    await deliverNotificationSafely(db, outboxId);
    return redirect(reservation.booking_code, "success");
  } catch (error) {
    await markLinePayReconciliation(db, payment.id, null, "unknown");
    logPayment("linepay.confirm_failed", {
      reservation_id: reservation.id,
      booking_code: reservation.booking_code,
      order_id: orderId,
      error: safeLinePayError(error),
    });
    // Provider timeout is unknown, not proof of failure. The status route can reconcile it.
    return redirect(reservation.booking_code, "pending");
  }
}
