/**
 * Structured operational logs (cron, webhook, guest API).
 * Persists to ops_events when table is available (OPS-004b).
 */
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";

export type OpsLogDomain = "cron" | "webhook" | "guest" | "admin" | "payment";

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
  | "guest.booking_step"
  | "guest.booking_created"
  | "guest.booking_submit_success"
  | "guest.booking_submit_error"
  | "guest.booking_success_viewed"
  | "guest.cancel_ok"
  | "guest.cancel_blocked"
  | "guest.refund_requested"
  | "admin.payment_approved"
  | "admin.payment_rejected"
  | "admin.waitlist_expired"
  | "admin.waitlist_staff_called"
  | "payment.intent_created"
  | "payment.deposit_confirmed"
  | "payment.refund_processed"
  | "stripe.signature_failed"
  | "stripe.payment_intent_succeeded"
  | "stripe.payment_intent_failed"
  | "stripe.charge_refunded"
  | "stripe.event_unhandled"
  | "stripe.webhook_error";

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

/** Optional detail.idempotency_key prevents duplicate funnel rows within 24h. */
export function opsEventIdempotencyKey(detail: Record<string, unknown>): string | null {
  const k = detail.idempotency_key;
  return typeof k === "string" && k.length >= 8 && k.length <= 128 ? k : null;
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
  const idem = opsEventIdempotencyKey(detail);
  if (idem) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: existing } = await db
      .from("ops_events")
      .select("id")
      .eq("domain", domain)
      .eq("action", action)
      .gte("ts", since)
      .contains("detail", { idempotency_key: idem })
      .limit(1);
    if (existing && existing.length > 0) return;
  }
  const { error } = await db.from("ops_events").insert({
    domain,
    action,
    detail,
  });
  if (error && !/ops_events/i.test(error.message)) {
    throw error;
  }
}
