/**
 * Structured operational logs (cron, webhook, guest API).
 * Persists to ops_events when table is available (OPS-004b).
 */
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";

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
  | "guest.booking_flow_entered"
  | "guest.booking_created"
  | "guest.booking_success_viewed"
  | "admin.payment_approved"
  | "admin.payment_rejected"
  | "admin.waitlist_expired";

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
  persistOpsEvent(domain, action, detail).catch(() => {
    /* fail-open */
  });
}

async function persistOpsEvent(
  domain: OpsLogDomain,
  action: OpsLogAction,
  detail: Record<string, unknown>
): Promise<void> {
  if (!isAdminConfigured()) return;
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error } = await db.from("ops_events").insert({
    domain,
    action,
    detail,
  });
  if (error && !/ops_events/i.test(error.message)) {
    throw error;
  }
}
