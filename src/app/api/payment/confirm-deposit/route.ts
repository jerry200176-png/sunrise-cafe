import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { markDepositPaid, verifyStripeIntentForReservation } from "@/lib/deposit-paid";
import { logOps } from "@/lib/ops-log";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/payment/confirm-deposit
 *
 * 前端完成 Stripe 付款後，由此端點驗證 PaymentIntent 狀態並更新 reservation。
 * Webhook 是主要更新路徑；此端點作為 fallback，供前端在付款完成後主動確認。
 *
 * Request:  { paymentIntentId, reservationId }
 * Response: { status, depositStatus }
 * Errors:   404（預約不存在）、500（API 錯誤）
 */
export async function POST(request: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe 支付尚未啟用" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { paymentIntentId, reservationId } = body as {
      paymentIntentId: string;
      reservationId: string;
    };

    if (!paymentIntentId || !reservationId) {
      return NextResponse.json(
        { error: "缺少必填欄位（paymentIntentId, reservationId）" },
        { status: 400 }
      );
    }

    // 從 Stripe 取得 PaymentIntent 最新狀態
    const paymentIntent = await stripe!.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json({
        status: paymentIntent.status,
        depositStatus: "pending",
      });
    }

    // 驗證 reservation 存在
    const { data: reservation, error: resError } = await supabaseAdmin()
      .from("reservations")
      .select("id, deposit_status, is_deposit_paid")
      .eq("id", reservationId)
      .maybeSingle();

    if (resError) {
      return NextResponse.json({ error: "付款資料暫時無法確認，請稍後再試或聯繫店家" }, { status: 503 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "預約不存在" }, { status: 404 });
    }

    // 付款必須屬於此預約且足額，否則任何成功的 PaymentIntent 都能替別人的預約標記已付
    const binding = await verifyStripeIntentForReservation(paymentIntent, reservationId);
    if (!binding.ok) {
      return NextResponse.json({ error: binding.error }, { status: binding.status });
    }

    // 若尚未被 webhook 標記，在此補標
    if (reservation.deposit_status !== "paid" || !reservation.is_deposit_paid) {
      await markDepositPaid(reservationId, "stripe_confirm", {}, "stripe");

      await supabaseAdmin()
        .from("payment_intents")
        .update({ status: "succeeded", updated_at: new Date().toISOString() })
        .eq("stripe_pi_id", paymentIntentId);
    }

    logOps("payment", "payment.deposit_confirmed", {
      reservation_id: reservationId,
      stripe_pi_id: paymentIntentId,
    });

    return NextResponse.json({
      status: "succeeded",
      depositStatus: "paid",
    });
  } catch {
    console.error("[confirm-deposit] payment confirmation failed");
    return NextResponse.json({ error: "確認付款失敗，請稍後再試或聯繫店家" }, { status: 500 });
  }
}
