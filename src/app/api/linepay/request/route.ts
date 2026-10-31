import { NextRequest, NextResponse } from "next/server";
import { getDepositAmount } from "@/lib/booking-utils";
import { computeDepositDeadline, isDepositAutoCancelEnabled, shouldAutoRelease } from "@/lib/deposit-deadline";
import { verifyGuestBookingById } from "@/lib/guest-auth";
import {
  isLinePayConfigured,
  requestLinePayPayment,
} from "@/lib/line-pay";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { logPayment } from "@/lib/payment-log";
import { isAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { randomUUID } from "node:crypto";

type RequestBody = {
  reservation_id?: string;
  phone?: string;
  booking_code?: string;
};

function paymentUrl(info: Record<string, unknown> | undefined, key: "web" | "app") {
  const urls = info?.paymentUrl;
  if (!urls || typeof urls !== "object") return null;
  const value = (urls as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function transactionId(info: Record<string, unknown> | undefined): string | null {
  const value = info?.transactionId;
  return value == null ? null : String(value);
}

/** Create a payment URL that is cryptographically tied to one reservation. */
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "付款服務尚未完成後端設定" }, { status: 503 });
  }
  if (!isLinePayConfigured()) {
    return NextResponse.json({ error: "LINE Pay 尚未啟用，請改用頁面上的其他付款方式" }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "無效的付款請求" }, { status: 400 });
  }

  const reservationId = body.reservation_id?.trim() ?? "";
  const phone = body.phone?.trim() ?? "";
  const bookingCode = body.booking_code?.trim() ?? "";
  if (!reservationId || !phone || !bookingCode) {
    return NextResponse.json({ error: "請先驗證訂位資料" }, { status: 400 });
  }

  try {
    const verified = await verifyGuestBookingById(phone, bookingCode, reservationId);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }
    const reservation = verified.reservation;

    if (!["pending", "confirmed"].includes(reservation.status) || reservation.is_deposit_paid) {
      return NextResponse.json({ error: "這筆訂位目前不需要繳交訂金" }, { status: 409 });
    }
    if (reservation.total_price == null || Number(reservation.total_price) <= 0) {
      return NextResponse.json({ error: "訂位金額無法確認，請聯繫店家" }, { status: 409 });
    }

    // ADR-012：逾期不自動取消時訂位仍有效，客人可以付到訂位開始為止。
    if (isDepositAutoCancelEnabled()) {
      const deadline = computeDepositDeadline(reservation.created_at, reservation.start_time);
      if (shouldAutoRelease(deadline)) {
        return NextResponse.json({ error: "訂金期限已過，請聯繫店家確認訂位" }, { status: 409 });
      }
    } else if (shouldAutoRelease(new Date(reservation.start_time))) {
      return NextResponse.json({ error: "訂位時間已開始，請直接聯繫店家" }, { status: 409 });
    }

    const amount = getDepositAmount(Number(reservation.total_price));
    const db = supabaseAdmin();
    const now = new Date();
    const { data: existing, error: existingError } = await db
      .from("line_pay_payments")
      .select("order_id, transaction_id, amount, payment_url_web, payment_url_app, expires_at, status")
      .eq("reservation_id", reservation.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (
      existing?.payment_url_web &&
      Number(existing.amount) === amount &&
      (!existing.expires_at || new Date(existing.expires_at) > now)
    ) {
      return NextResponse.json({
        paymentUrl: { web: existing.payment_url_web, app: existing.payment_url_app },
        orderId: existing.order_id,
        reused: true,
      });
    }
    if (existing) {
      await db.from("line_pay_payments").update({ status: "expired", updated_at: now.toISOString() }).eq("order_id", existing.order_id);
    }

    const orderId = `SUNRISE-${reservation.booking_code}-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const apiResponse = await requestLinePayPayment({
      amount,
      currency: "TWD",
      orderId,
      packages: [{
        id: "deposit",
        amount,
        products: [{ name: `訂位 ${reservation.booking_code} 訂金`, quantity: 1, price: amount }],
      }],
      redirectUrls: {
        confirmUrl: `${LINE_SITE_URL}/api/linepay/confirm`,
        cancelUrl: `${LINE_SITE_URL}/api/linepay/cancel`,
      },
    });

    const info = apiResponse.info;
    const webUrl = paymentUrl(info, "web");
    const appUrl = paymentUrl(info, "app");
    const txId = transactionId(info);
    if (!webUrl || !txId) throw new Error("LINE Pay 未回傳付款網址或交易序號");

    const { error: insertError } = await db.from("line_pay_payments").insert({
      reservation_id: reservation.id,
      order_id: orderId,
      transaction_id: txId,
      amount,
      currency: "TWD",
      status: "pending",
      payment_url_web: webUrl,
      payment_url_app: appUrl,
      response_payload: apiResponse,
      expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      updated_at: now.toISOString(),
    });
    if (insertError) throw insertError;

    logPayment("linepay.requested", {
      reservation_id: reservation.id,
      booking_code: reservation.booking_code,
      order_id: orderId,
      amount,
    });
    return NextResponse.json({
      paymentUrl: { web: webUrl, app: appUrl },
      orderId,
      reused: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LINE Pay 付款建立失敗";
    logPayment("linepay.request_failed", { reservation_id: reservationId, error: message });
    return NextResponse.json({ error: "LINE Pay 付款建立失敗，請稍後再試或聯繫店家" }, { status: 502 });
  }
}
