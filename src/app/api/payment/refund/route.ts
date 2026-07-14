import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";
import { logOps } from "@/lib/ops-log";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/payment/refund
 *
 * 管理後台退款 API。需 payments:approve 權限。
 * 對 Stripe PaymentIntent 發起全額退款，並更新 reservation deposit_status。
 *
 * Request:  { reservationId, reason? }
 * Response: { ok, refundId, status }
 * Errors:   400（無 Stripe 付款紀錄/尚未付款）、404（預約不存在）、403（無權限）
 */
export async function POST(request: NextRequest) {
  const denied = await requirePermission(request, "payments:approve");
  if (denied) return denied;

  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe 支付尚未啟用" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { reservationId, reason } = body as {
      reservationId: string;
      reason?: string;
    };

    if (!reservationId) {
      return NextResponse.json(
        { error: "缺少必填欄位（reservationId）" },
        { status: 400 }
      );
    }

    const { data: reservation, error: resError } = await supabaseAdmin()
      .from("reservations")
      .select("id, payment_intent_id, deposit_status, booking_code")
      .eq("id", reservationId)
      .single();

    if (resError || !reservation) {
      return NextResponse.json({ error: "預約不存在" }, { status: 404 });
    }

    if (!reservation.payment_intent_id) {
      return NextResponse.json(
        { error: "此預約無 Stripe 付款紀錄，無法退款" },
        { status: 400 }
      );
    }

    if (reservation.deposit_status !== "paid") {
      return NextResponse.json(
        { error: `此預約訂金狀態為「${reservation.deposit_status}」，無法退款` },
        { status: 400 }
      );
    }

    const refund = await stripe!.refunds.create({
      payment_intent: reservation.payment_intent_id,
      reason: "requested_by_customer" as const,
      metadata: {
        reservationId,
        bookingCode: reservation.booking_code ?? "",
        reason: reason || "",
      },
    });

    await supabaseAdmin()
      .from("payment_intents")
      .update({ status: "refunded", updated_at: new Date().toISOString() })
      .eq("stripe_pi_id", reservation.payment_intent_id);

    await supabaseAdmin()
      .from("reservations")
      .update({ deposit_status: "refunded" })
      .eq("id", reservationId);

    logOps("payment", "payment.refund_processed", {
      reservation_id: reservationId,
      booking_code: reservation.booking_code,
      stripe_pi_id: reservation.payment_intent_id,
      refund_id: refund.id,
      reason: reason || null,
    });

    return NextResponse.json({
      ok: true,
      refundId: refund.id,
      status: refund.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "退款失敗";
    console.error("[refund] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
