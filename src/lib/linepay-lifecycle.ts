import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  checkLinePayPaymentRequestStatus,
  confirmLinePayPayment,
  retrieveLinePayPaymentDetails,
  type LinePayApiResponse,
} from "@/lib/line-pay";
import { logPayment } from "@/lib/payment-log";

export type LinePayPaymentRow = {
  id: string;
  reservation_id: string;
  order_id: string;
  transaction_id: string | null;
  amount: number;
  currency: "TWD";
  status: string;
  confirm_started_at?: string | null;
};

export type LinePayReservationRow = {
  id: string;
  customer_name: string;
  booking_code: string;
  start_time: string;
  end_time: string;
  is_deposit_paid: boolean;
};

export type LinePayLifecycleResult =
  | { status: "paid"; outboxId?: string }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "failed" }
  | { status: "unknown" };

type ProviderRecord = Record<string, unknown>;

function recordsFrom(value: unknown): ProviderRecord[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(recordsFrom);
  const record = value as ProviderRecord;
  return [record, ...Object.values(record).flatMap(recordsFrom)];
}

function providerCode(response: LinePayApiResponse): string {
  return typeof response.returnCode === "string" ? response.returnCode : "unknown";
}

/** Validate provider identifiers and amount before local payment finalization. */
export function providerPaymentMatches(
  response: LinePayApiResponse,
  expected: { orderId: string; transactionId: string; amount: number; requireAmount?: boolean }
): boolean {
  const records = recordsFrom(response.info);
  let sawAmount = false;
  for (const record of records) {
    if (record.orderId != null && String(record.orderId) !== expected.orderId) return false;
    if (record.transactionId != null && String(record.transactionId) !== expected.transactionId) {
      return false;
    }
    for (const key of ["amount", "totalAmount", "packageAmount"]) {
      if (record[key] == null) continue;
      const value = Number(record[key]);
      if (!Number.isFinite(value)) return false;
      sawAmount = true;
      if (value !== expected.amount) return false;
    }
  }
  return !expected.requireAmount || sawAmount;
}

export function safeLinePayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(secret|token|authorization)[=:][^\s,]+/gi, "$1=[redacted]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

export async function claimPaymentConfirmation(
  db: SupabaseClient,
  paymentId: string
): Promise<{ claimed: boolean; attemptId: string }> {
  const attemptId = randomUUID();
  const { data, error } = await db
    .from("line_pay_payments")
    .update({
      status: "confirming",
      confirm_attempt_id: attemptId,
      confirm_started_at: new Date().toISOString(),
      reconciliation_status: "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return { claimed: Boolean(data), attemptId };
}

export async function markLinePayReconciliation(
  db: SupabaseClient,
  paymentId: string,
  response: LinePayApiResponse | null,
  state: "unknown" | "resolved" | "failed",
  status?: "cancelled" | "failed"
) {
  const update: Record<string, unknown> = {
    reconciliation_status: state,
    last_reconciled_at: new Date().toISOString(),
    last_provider_code: response ? providerCode(response) : null,
    last_provider_message: response?.returnMessage?.slice(0, 300) ?? null,
    updated_at: new Date().toISOString(),
  };
  if (status) update.status = status;
  await db.from("line_pay_payments").update(update).eq("id", paymentId).neq("status", "paid");
}

export async function finalizeLinePayPayment(
  db: SupabaseClient,
  payment: LinePayPaymentRow,
  reservation: LinePayReservationRow,
  response: LinePayApiResponse,
  transactionId: string
): Promise<string> {
  const { data, error } = await db.rpc("finalize_line_pay_payment", {
    p_payment_id: payment.id,
    p_transaction_id: transactionId,
    p_response_payload: response,
    p_payload: {
      customer_name: reservation.customer_name,
      booking_code: reservation.booking_code,
      start_time: reservation.start_time,
      end_time: reservation.end_time,
      amount: payment.amount,
    },
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.outbox_id) throw new Error("LINE Pay local finalization returned no outbox");
  logPayment("linepay.confirmed", {
    reservation_id: reservation.id,
    booking_code: reservation.booking_code,
    order_id: payment.order_id,
    transaction_id: transactionId,
    amount: payment.amount,
  });
  return String(row.outbox_id);
}

export async function reconcileLinePayPayment(
  db: SupabaseClient,
  payment: LinePayPaymentRow,
  reservation: LinePayReservationRow
): Promise<LinePayLifecycleResult> {
  if (payment.status === "paid") return { status: "paid" };
  if (!payment.transaction_id) return { status: "unknown" };

  try {
    const checked = await checkLinePayPaymentRequestStatus(payment.transaction_id);
    const code = providerCode(checked);
    if (code === "0000") {
      await markLinePayReconciliation(db, payment.id, checked, "resolved");
      return { status: "pending" };
    }
    if (code === "0121") {
      await markLinePayReconciliation(db, payment.id, checked, "failed", "cancelled");
      return { status: "cancelled" };
    }
    if (code === "0122") {
      await markLinePayReconciliation(db, payment.id, checked, "failed", "failed");
      return { status: "failed" };
    }
    if (code === "0110") {
      const confirmed = await confirmLinePayPayment(payment.transaction_id, Number(payment.amount), payment.currency);
      if (confirmed.returnCode !== "0000" || !providerPaymentMatches(confirmed, {
        orderId: payment.order_id,
        transactionId: payment.transaction_id,
        amount: Number(payment.amount),
      })) {
        await markLinePayReconciliation(db, payment.id, confirmed, "unknown");
        return { status: "unknown" };
      }
      const outboxId = await finalizeLinePayPayment(db, payment, reservation, confirmed, payment.transaction_id);
      return { status: "paid", outboxId };
    }
    if (code === "0123") {
      const details = await retrieveLinePayPaymentDetails({ transactionId: payment.transaction_id });
      if (details.returnCode !== "0000" || !providerPaymentMatches(details, {
        orderId: payment.order_id,
        transactionId: payment.transaction_id,
        amount: Number(payment.amount),
        requireAmount: true,
      })) {
        await markLinePayReconciliation(db, payment.id, details, "unknown");
        return { status: "unknown" };
      }
      const outboxId = await finalizeLinePayPayment(db, payment, reservation, details, payment.transaction_id);
      return { status: "paid", outboxId };
    }
    await markLinePayReconciliation(db, payment.id, checked, "unknown");
    return { status: "unknown" };
  } catch (error) {
    await markLinePayReconciliation(db, payment.id, null, "unknown");
    logPayment("linepay.confirm_failed", {
      reservation_id: reservation.id,
      booking_code: reservation.booking_code,
      order_id: payment.order_id,
      error: safeLinePayError(error),
    });
    return { status: "unknown" };
  }
}
