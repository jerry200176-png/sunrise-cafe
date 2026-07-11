/**
 * Structured operational logs (cron, webhook, guest API).
 * Extends payment-log pattern — JSON lines for Vercel / log drains.
 */

export type OpsLogDomain = "cron" | "webhook" | "guest";

export type OpsLogAction =
  | "cron.completed"
  | "cron.run_failed"
  | "cron.failure_notified"
  | "cron.partial_failure"
  | "webhook.event_ok"
  | "webhook.event_error"
  | "webhook.signature_failed"
  | "guest.lookup_denied_rate_limit";

export function logOps(
  domain: OpsLogDomain,
  action: OpsLogAction,
  detail: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      domain,
      action,
      ...detail,
    })
  );
}
