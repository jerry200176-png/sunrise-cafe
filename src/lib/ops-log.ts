/**
 * Structured operational logs (cron, webhook, guest API).
 * Extends payment-log pattern — JSON lines for Vercel / log drains.
 */

import * as Sentry from "@sentry/nextjs";

export type OpsLogDomain = "cron" | "webhook" | "guest" | "admin";

export type OpsLogAction =
  | "cron.completed"
  | "cron.run_failed"
  | "cron.failure_notified"
  | "cron.partial_failure"
  | "webhook.event_ok"
  | "webhook.event_error"
  | "webhook.signature_failed"
  | "webhook.event_handled"
  | "guest.lookup_denied_rate_limit"
  | "guest.deposit_instructions_viewed"
  | "guest.payment_line_pay_click"
  | "guest.payment_line_official_click"
  | "admin.payment_approved"
  | "admin.payment_rejected";

export type AdminPaymentInteraction = "keyboard" | "click";

function addOpsBreadcrumb(
  domain: OpsLogDomain,
  action: OpsLogAction,
  detail: Record<string, unknown>
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    Sentry.addBreadcrumb({
      category: `ops.${domain}`,
      message: action,
      data: detail,
      level: action.includes("error") || action.includes("failed") ? "warning" : "info",
    });
  } catch {
    /* fail-open */
  }
}

export function logOps(
  domain: OpsLogDomain,
  action: OpsLogAction,
  detail: Record<string, unknown>
): void {
  addOpsBreadcrumb(domain, action, detail);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      domain,
      action,
      ...detail,
    })
  );
}
