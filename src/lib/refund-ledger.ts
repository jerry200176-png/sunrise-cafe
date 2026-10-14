/**
 * 退款帳本（#444）：Stripe 退款結果同步到 reservation_refunds／reservation_refund_events。
 * 帳本只能新增；狀態只有 succeeded 才算真的退了（見 docs/PAYMENT_STATE_MODEL.md「退款」）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSettlementSchemaMissing, stripeRefundStatus } from "@/lib/room-settlement";

export type StripeRefundLike = {
  id: string;
  status?: string | null;
  amount: number;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

export type RefundLedgerResult = {
  id: string;
  reservation_id: string;
  kind: string;
  amount: number;
  status: string;
  deposit_gross: number;
  deposit_refunded: number;
};

const piId = (refund: StripeRefundLike) =>
  typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;

/**
 * 把一筆 Stripe 退款的目前狀態寫進帳本（重送同一狀態不會多記）。
 * 回傳 null = 找不到對應訂位（不是我們的退款）；{ schemaMissing: true } = migration 還沒套用。
 */
export async function syncStripeRefund(
  db: SupabaseClient,
  refund: StripeRefundLike
): Promise<RefundLedgerResult | { schemaMissing: true } | null> {
  let reservationId = refund.metadata?.reservationId || null;
  const paymentIntent = piId(refund);
  if (!reservationId && paymentIntent) {
    const { data } = await db.from("payment_intents").select("reservation_id").eq("stripe_pi_id", paymentIntent).maybeSingle();
    reservationId = (data?.reservation_id as string | undefined) ?? null;
  }
  if (!reservationId) return null;
  const result = await db.rpc("sync_provider_refund", {
    p_reservation_id: reservationId,
    p_ledger_refund_id: refund.metadata?.refund_ledger_id || null,
    p_provider_ref: refund.id,
    p_amount: refund.amount,
    p_status: stripeRefundStatus(refund.status),
  });
  if (result.error) {
    if (isSettlementSchemaMissing(result.error)) return { schemaMissing: true };
    throw result.error;
  }
  return result.data as RefundLedgerResult;
}

/** 訂金已經全額真的退掉（只看 succeeded） */
export function isDepositFullyRefunded(result: Pick<RefundLedgerResult, "deposit_gross" | "deposit_refunded">): boolean {
  return result.deposit_gross > 0 && result.deposit_refunded >= result.deposit_gross;
}
