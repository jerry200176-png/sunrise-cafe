import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { markDepositPaid, verifyStripeIntentForReservation } from "@/lib/deposit-paid";
import { logOps } from "@/lib/ops-log";
import { isDepositFullyRefunded, syncStripeRefund, type StripeRefundLike } from "@/lib/refund-ledger";

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
 * - charge.refunded / refund.created / refund.updated / refund.failed / charge.refund.updated
 *     → 退款結果寫進退款帳本（#444）。只有 Stripe 回報 succeeded 才算已退；
 *       全額真的退掉時，SQL 才把 deposit_status 改成 refunded（部分退款、處理中、失敗都不會）。
 */
/**
 * 退款同步到帳本。帳本表還不存在（migration 尚未套用）時退回舊做法，但只在「整筆都退掉」時才標 refunded，
 * 部分退款不再把整筆訂金當成退掉。
 */
async function syncRefunds(
  refunds: StripeRefundLike[],
  paymentIntentId: string | null,
  charge: { amount: number; amount_refunded: number } | null
) {
  let fullyRefunded = false;
  let schemaMissing = false;
  for (const refund of refunds) {
    const result = await syncStripeRefund(supabaseAdmin(), refund);
    if (result && "schemaMissing" in result) { schemaMissing = true; break; }
    if (result) fullyRefunded = isDepositFullyRefunded(result);
  }
  if (!paymentIntentId) return;
  if (schemaMissing) {
    if (!charge || charge.amount_refunded < charge.amount) return;
    fullyRefunded = true;
    const { data: pi } = await supabaseAdmin().from("payment_intents").select("reservation_id")
      .eq("stripe_pi_id", paymentIntentId).maybeSingle();
    if (pi?.reservation_id) {
      await supabaseAdmin().from("reservations").update({ deposit_status: "refunded" }).eq("id", pi.reservation_id);
    }
  }
  if (fullyRefunded) {
    await supabaseAdmin().from("payment_intents").update({ status: "refunded", updated_at: new Date().toISOString() })
      .eq("stripe_pi_id", paymentIntentId);
  }
}

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
  } catch (err) {
    const message = err instanceof Error ? err.message : "無效的簽章";
    console.error("[stripe-webhook] signature verification failed:", message);
    logOps("webhook", "stripe.signature_failed", { error: message });
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
        const { reservationId } = paymentIntent.metadata;

        await supabaseAdmin()
          .from("payment_intents")
          .update({ status: "succeeded", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", paymentIntent.id);

        if (reservationId) {
          try {
            const binding = await verifyStripeIntentForReservation(paymentIntent, reservationId);
            if (!binding.ok) {
              console.error("[stripe-webhook] PaymentIntent rejected for reservation:", binding.error, paymentIntent.id);
              break;
            }
            await markDepositPaid(reservationId, "stripe_webhook", {}, "stripe");
          } catch (err) {
            console.error("[stripe-webhook] markDepositPaid failed:", err);
          }
        }

        logOps("webhook", "stripe.payment_intent_succeeded", {
          stripe_pi_id: paymentIntent.id,
          reservation_id: reservationId ?? null,
        });
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;

        await supabaseAdmin()
          .from("payment_intents")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", paymentIntent.id);

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

        if (paymentIntentId) {
          // charge 物件不一定附上 refunds：直接向 Stripe 列出這筆付款的所有退款，一筆一筆同步
          const refunds = await stripe!.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
          await syncRefunds(refunds.data, paymentIntentId, charge);
        }

        logOps("webhook", "stripe.charge_refunded", {
          charge_id: charge.id,
          stripe_pi_id: paymentIntentId,
        });
        break;
      }

      case "refund.created":
      case "refund.updated":
      case "refund.failed":
      case "charge.refund.updated": {
        const refund = event.data.object as StripeRefundLike;
        const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;
        await syncRefunds([refund], paymentIntentId, null);
        logOps("webhook", "stripe.refund_synced", { refund_id: refund.id, status: refund.status ?? null, stripe_pi_id: paymentIntentId });
        break;
      }

      default: {
        logOps("webhook", "stripe.event_unhandled", {
          event_type: event.type,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "處理 webhook 失敗";
    console.error("[stripe-webhook] processing error:", message);
    logOps("webhook", "stripe.webhook_error", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
