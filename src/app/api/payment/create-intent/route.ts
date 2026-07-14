import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBranchDepositConfig } from "@/lib/constants";

interface CreateIntentBody {
  reservationId: string;
  branchId: string;
  amount: number;
  currency?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateIntentBody;
    const { reservationId, branchId, amount, currency = "twd" } = body;

    if (
      !reservationId ||
      !branchId ||
      amount == null ||
      typeof amount !== "number" ||
      Number.isNaN(amount)
    ) {
      return NextResponse.json(
        { error: "缺少 reservationId、branchId 或 amount 參數" },
        { status: 400 }
      );
    }

    // 驗證預約存在且尚未付款
    const sb = supabaseAdmin();
    const { data: reservation, error: fetchErr } = await sb
      .from("reservations")
      .select("id, status, is_deposit_paid, start_time")
      .eq("id", reservationId)
      .single();

    if (fetchErr || !reservation) {
      return NextResponse.json(
        { error: "找不到此預約" },
        { status: 404 }
      );
    }

    if (reservation.status === "cancelled" || reservation.status === "completed") {
      return NextResponse.json(
        { error: "此預約已取消或已完成，無法付款" },
        { status: 400 }
      );
    }

    if (reservation.is_deposit_paid) {
      return NextResponse.json(
        { error: "此預約已完成訂金付款" },
        { status: 400 }
      );
    }

    // 檢查是否超過訂位開始時間
    if (new Date(reservation.start_time) < new Date()) {
      return NextResponse.json(
        { error: "此預約時段已過，無法付款" },
        { status: 400 }
      );
    }

    // 驗證付款金額符合分店設定，防止客戶竄改 amount
    const depositConfig = getBranchDepositConfig(branchId);
    if (amount !== depositConfig.defaultDepositAmount) {
      return NextResponse.json(
        { error: "付款金額不符合分店設定" },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount, // Stripe 以分為單位 (TWD)
        currency,
        metadata: {
          reservation_id: reservationId,
          branch_id: branchId,
        },
      },
      {
        idempotencyKey: `reservation_${reservationId}_deposit`,
      },
    );

    // 記錄 payment_intent 到 DB
    const { error: insertErr } = await sb.from("payment_intents").insert({
      stripe_pi_id: paymentIntent.id,
      reservation_id: reservationId,
      branch_id: branchId,
      amount,
      currency,
      status: "pending",
    });

    if (insertErr) {
      console.error("Failed to record payment_intent:", insertErr);
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
    });
  } catch (err) {
    console.error("create-intent error:", err);
    const message = err instanceof Error ? err.message : "建立付款失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
