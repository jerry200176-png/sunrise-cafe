import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { markDepositPaid } from "@/lib/deposit-paid";
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
      .single();

    if (resError || !reservation) {
      return NextResponse.json({ error: "預約不存在" }, { status: 404 });
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "確認付款失敗";
    console.error("[confirm-deposit] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
