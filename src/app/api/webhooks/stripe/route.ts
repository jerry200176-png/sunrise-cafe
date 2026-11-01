import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { markDepositPaid, verifyStripeIntentForReservation } from "@/lib/deposit-paid";
import { logOps } from "@/lib/ops-log";

/**
 * Stripe webhook 需要 raw body 以驗證簽章。
 * Vercel 上必須關閉內建 bodyParser。
 */
export const config = { api: { bodyParser: false } };

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/webhooks/stripe
 *
 * 接收 Stripe 事件通知，處理：
 * - payment_intent.succeeded  → 標記 reservation deposit_status = 'paid'
 * - payment_intent.payment_failed → 更新 payment_intents.status = 'failed'
 * - charge.refunded           → 標記 reservation deposit_status = 'refunded'
 */
export async function POST(request: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe 支付尚未啟用" },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  // ── 簽章驗證 ────────────────────────────────────────────────────
  let event;
  try {
    event = stripe!.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    // Parser errors can include fragments of a validly signed malformed body.
    console.error("[stripe-webhook] signature or payload verification failed");
    logOps("webhook", "stripe.signature_failed", { error: "invalid_signature_or_payload" });
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    );
  }

  // ── 事件處理 ────────────────────────────────────────────────────
  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const reservationId = paymentIntent.metadata?.reservationId;
        if (!reservationId) throw new Error("Stripe payment binding unavailable");

        const binding = await verifyStripeIntentForReservation(paymentIntent, reservationId);
        if (!binding.ok) {
          // Keep provider redelivery possible until durable reconciliation exists.
          // A confirmed mismatch is different from an unavailable DB lookup;
          // neither should be acknowledged here without preserving evidence.
          console.error("[stripe-webhook] payment binding not verified", binding.status);
          throw new Error("Stripe payment binding not verified");
        }

        const { error: ledgerError } = await supabaseAdmin()
          .from("payment_intents")
          .update({ status: "succeeded", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", paymentIntent.id);
        if (ledgerError) throw new Error("Stripe payment ledger update failed");

        try {
          await markDepositPaid(reservationId, "stripe_webhook", {}, "stripe");
        } catch {
          // A signed success event must remain eligible for provider retry if
          // recording it failed; do not acknowledge a swallowed exception.
          throw new Error("Stripe payment recording failed");
        }

        logOps("webhook", "stripe.payment_intent_succeeded", {
          stripe_pi_id: paymentIntent.id,
          reservation_id: reservationId ?? null,
        });
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;

        const { error: failedWriteError } = await supabaseAdmin()
          .from("payment_intents")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", paymentIntent.id);
        if (failedWriteError) throw new Error("Stripe failed payment recording failed");

        logOps("webhook", "stripe.payment_intent_failed", {
          stripe_pi_id: paymentIntent.id,
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : null;

        // No durable inbox exists yet: never acknowledge an unhandled expanded or
        // missing identity as though the refund had been recorded.
        if (!paymentIntentId) throw new Error("Stripe refund identity unavailable");
        if (paymentIntentId) {
          const { error: refundWriteError } = await supabaseAdmin()
            .from("payment_intents")
            .update({ status: "refunded", updated_at: new Date().toISOString() })
            .eq("stripe_pi_id", paymentIntentId);
          if (refundWriteError) throw new Error("Stripe refund recording failed");

          const { data: pi, error: refundLookupError } = await supabaseAdmin()
            .from("payment_intents")
            .select("reservation_id")
            .eq("stripe_pi_id", paymentIntentId)
            .single();

          if (refundLookupError || !pi?.reservation_id) throw new Error("Stripe refund reservation lookup failed");
          if (pi?.reservation_id) {
            const { error: reservationRefundError } = await supabaseAdmin()
              .from("reservations")
              .update({ deposit_status: "refunded" })
              .eq("id", pi.reservation_id);
            if (reservationRefundError) throw new Error("Stripe reservation refund recording failed");
          }
        }

        logOps("webhook", "stripe.charge_refunded", {
          charge_id: charge.id,
          stripe_pi_id: paymentIntentId,
        });
        break;
      }

      default: {
        logOps("webhook", "stripe.event_unhandled", {
          event_type: event.type,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch {
    console.error("[stripe-webhook] processing error");
    logOps("webhook", "stripe.webhook_error", { error: "processing_failed" });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
