/**
 * 結構化付款路徑日誌（Vercel logs / Sentry breadcrumbs 友善）
 */

export type PaymentLogAction =
  | "payment_event.created"
  | "payment_event.approved"
  | "payment_event.rejected"
  | "payment_event.duplicate_skipped"
  | "payment_event.insert_failed"
  | "deposit_deadline.cron_run"
  | "deposit_deadline.released"
  | "deposit_deadline.reminded"
  | "payment_reconcile.import";

export function logPayment(
  action: PaymentLogAction,
  detail: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      domain: "payment",
      action,
      ...detail,
    })
  );
}
