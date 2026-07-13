import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Vercel 上需關閉 bodyParser 以取得 raw body 驗證 webhook signature */
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  const sb = supabaseAdmin();

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const reservationId = pi.metadata?.reservation_id;

        if (!reservationId) {
          console.warn("payment_intent.succeeded without reservation_id metadata");
          break;
        }

        // 更新 payment_intents 記錄
        await sb
          .from("payment_intents")
          .update({ status: "succeeded", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", pi.id);

        // 更新訂位狀態
        await sb
          .from("reservations")
          .update({
            is_deposit_paid: true,
            deposit_payment_note: `Stripe ${pi.id}`,
            status: "confirmed",
          })
          .eq("id", reservationId);

        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const reservationId = pi.metadata?.reservation_id;

        // 更新 payment_intents 記錄為 failed
        await sb
          .from("payment_intents")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", pi.id);

        if (reservationId) {
          await sb
            .from("reservations")
            .update({
              deposit_payment_note: `Stripe 付款失敗: ${pi.id} (${pi.last_payment_error?.message ?? "未知錯誤"})`,
            })
            .eq("id", reservationId);
        }

        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = charge.payment_intent as string;

        if (piId) {
          await sb
            .from("payment_intents")
            .update({ status: "refunded", updated_at: new Date().toISOString() })
            .eq("stripe_pi_id", piId);

          // 取得關聯的 reservation_id
          const { data: piRecord } = await sb
            .from("payment_intents")
            .select("reservation_id")
            .eq("stripe_pi_id", piId)
            .single();

          if (piRecord?.reservation_id) {
            await sb
              .from("reservations")
              .update({
                is_deposit_paid: false,
                deposit_payment_note: `Stripe 已退款: ${piId}`,
              })
              .eq("id", piRecord.reservation_id);
          }
        }

        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
