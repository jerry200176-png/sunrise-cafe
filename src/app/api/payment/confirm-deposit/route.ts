import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface ConfirmDepositBody {
  paymentIntentId: string;
  reservationId: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConfirmDepositBody;
    const { paymentIntentId, reservationId } = body;

    if (!paymentIntentId || !reservationId) {
      return NextResponse.json(
        { error: "缺少 paymentIntentId 或 reservationId 參數" },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // 向 Stripe 查詢 PaymentIntent 最終狀態
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json(
        {
          status: paymentIntent.status,
          depositStatus: "pending",
        },
        { status: 200 }
      );
    }

    const sb = supabaseAdmin();

    // 更新 payment_intents 記錄
    await sb
      .from("payment_intents")
      .update({ status: "succeeded", updated_at: new Date().toISOString() })
      .eq("stripe_pi_id", paymentIntentId);

    // 更新 reservations 訂金狀態
    const { error: updateErr } = await sb
      .from("reservations")
      .update({
        is_deposit_paid: true,
        deposit_payment_note: `Stripe ${paymentIntentId}`,
        status: "confirmed",
      })
      .eq("id", reservationId);

    if (updateErr) {
      console.error("Failed to update reservation deposit:", updateErr);
      return NextResponse.json(
        { error: "付款成功但更新訂位狀態失敗，請聯絡店家" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "succeeded",
      depositStatus: "paid",
    });
  } catch (err) {
    console.error("confirm-deposit error:", err);
    const message = err instanceof Error ? err.message : "確認付款失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
