import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { logOps } from "@/lib/ops-log";
import { getBranchDepositConfig } from "@/lib/constants";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/payment/create-intent
 *
 * 建立 Stripe PaymentIntent 並回傳 client_secret 供前端 Stripe Elements 使用。
 *
 * Request:  { reservationId, branchId, amount, currency? }
 * Response: { clientSecret, paymentIntentId, amount }
 * Errors:   400（預約已過期/已付款）、404（預約不存在）、500（Stripe API 錯誤）
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
    const { reservationId, branchId, amount, currency } = body as {
      reservationId: string;
      branchId: string;
      amount: number;
      currency?: string;
    };

    if (!reservationId || !branchId || !amount) {
      return NextResponse.json(
        { error: "缺少必填欄位（reservationId, branchId, amount）" },
        { status: 400 }
      );
    }

    if (typeof amount !== "number" || amount <= 0 || !Number.isInteger(amount)) {
      return NextResponse.json(
        { error: "金額必須為正整數（單位：分）" },
        { status: 400 }
      );
    }

    // 驗證付款金額符合分店設定，防止客戶端竄改 amount
    const depositConfig = getBranchDepositConfig(branchId);
    if (amount !== depositConfig.defaultDepositAmount) {
      return NextResponse.json(
        { error: "付款金額不符合分店設定" },
        { status: 400 }
      );
    }

    // 驗證預約存在且可付款
    const { data: reservation, error: resError } = await supabaseAdmin()
      .from("reservations")
      .select("id, status, is_deposit_paid, deposit_status, start_time")
      .eq("id", reservationId)
      .single();

    if (resError || !reservation) {
      return NextResponse.json({ error: "預約不存在" }, { status: 404 });
    }

    if (reservation.is_deposit_paid || reservation.deposit_status === "paid") {
      return NextResponse.json({ error: "此預約已完成付款" }, { status: 400 });
    }

    if (reservation.status === "cancelled" || reservation.status === "completed") {
      return NextResponse.json({ error: "預約已取消或已完成，無法付款" }, { status: 400 });
    }

    // 檢查是否超過訂位開始時間
    if (new Date(reservation.start_time) < new Date()) {
      return NextResponse.json(
        { error: "此預約時段已過，無法付款" },
        { status: 400 }
      );
    }

    // 建立 Stripe PaymentIntent（使用 idempotencyKey 防止重複建立）
    const paymentIntent = await stripe!.paymentIntents.create(
      {
        amount,
        currency: currency || "twd",
        metadata: {
          reservationId,
          branchId,
        },
      },
      {
        idempotencyKey: `reservation_${reservationId}_deposit`,
      }
    );

    // 寫入 payment_intents 表
    const { error: insertError } = await supabaseAdmin()
      .from("payment_intents")
      .insert({
        stripe_pi_id: paymentIntent.id,
        reservation_id: reservationId,
        branch_id: branchId,
        amount,
        currency: currency || "twd",
        status: "pending",
      });

    if (insertError) {
      console.error("[create-intent] insert payment_intents failed:", insertError);
    }

    // 更新 reservation 關聯 payment_intent_id
    await supabaseAdmin()
      .from("reservations")
      .update({ payment_intent_id: paymentIntent.id })
      .eq("id", reservationId);

    logOps("payment", "payment.intent_created", {
      reservation_id: reservationId,
      stripe_pi_id: paymentIntent.id,
      amount,
      currency: currency || "twd",
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "建立付款失敗";
    console.error("[create-intent] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
