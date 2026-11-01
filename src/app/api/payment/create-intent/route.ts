import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { logOps } from "@/lib/ops-log";
import { getBranchDepositConfig } from "@/lib/constants";
import { getDepositAmount } from "@/lib/booking-utils";

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

    if (!reservationId || !branchId || amount == null) {
      return NextResponse.json(
        { error: "缺少必填欄位（reservationId, branchId, amount）" },
        { status: 400 }
      );
    }

    if (typeof amount !== "number" || amount <= 0 || !Number.isSafeInteger(amount)) {
      return NextResponse.json(
        { error: "金額必須為正整數（單位：元）" },
        { status: 400 }
      );
    }

    if (currency !== undefined && (typeof currency !== "string" || currency.toLowerCase() !== "twd")) {
      return NextResponse.json(
        { error: "僅支援新台幣付款" },
        { status: 400 }
      );
    }

    // The caller cannot choose a different branch's payment settings. Resolve
    // the branch from the reservation's room before checking the feature flag.
    const { data: reservation, error: resError } = await supabaseAdmin()
      .from("reservations")
      .select("id, status, is_deposit_paid, deposit_status, start_time, total_price, room:rooms!inner(branch_id)")
      .eq("id", reservationId)
      .maybeSingle();

    if (resError) {
      return NextResponse.json({ error: "預約資料暫時無法確認，請稍後再試" }, { status: 503 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "預約不存在" }, { status: 404 });
    }

    const room = Array.isArray(reservation.room) ? reservation.room[0] : reservation.room;
    const actualBranchId = room?.branch_id;
    if (typeof actualBranchId !== "string" || !actualBranchId) {
      return NextResponse.json({ error: "分店資料暫時無法確認，請聯繫店家" }, { status: 503 });
    }
    if (branchId !== actualBranchId) {
      return NextResponse.json({ error: "預約與分店資料不符" }, { status: 403 });
    }
    const depositConfig = getBranchDepositConfig(actualBranchId);
    if (!depositConfig.stripeEnabled || !depositConfig.isDepositRequired) {
      return NextResponse.json({ error: "此分店尚未啟用線上付款" }, { status: 503 });
    }
    const totalPrice = reservation.total_price == null ? Number.NaN : Number(reservation.total_price);
    if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
      return NextResponse.json({ error: "訂位金額無法確認，請聯繫店家" }, { status: 409 });
    }
    const expectedAmount = getDepositAmount(totalPrice);
    const stripeAmount = expectedAmount * 100; // Stripe TWD charges use minor units.
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || !Number.isSafeInteger(stripeAmount) ||
        expectedAmount !== depositConfig.defaultDepositAmount) {
      return NextResponse.json({ error: "訂金設定與訂位金額不一致，請聯繫店家" }, { status: 409 });
    }
    if (amount !== expectedAmount) {
      return NextResponse.json({ error: "付款金額不符合訂位資料" }, { status: 400 });
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
        amount: stripeAmount,
        currency: "twd",
        metadata: {
          reservationId,
          branchId: actualBranchId,
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
        branch_id: actualBranchId,
        amount: stripeAmount,
        currency: "twd",
        status: "pending",
      });

    if (insertError) {
      console.error("[create-intent] insert payment_intents failed");
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
  } catch {
    console.error("[create-intent] payment request failed");
    return NextResponse.json({ error: "建立付款失敗，請稍後再試或聯繫店家" }, { status: 500 });
  }
}
