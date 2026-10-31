/**
 * Structured operational logs (cron, webhook, guest API).
 * Persists to ops_events when table is available (OPS-004b).
 */
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { isAdminConfigured } from "@/lib/supabase-admin";

export type OpsLogDomain = "cron" | "webhook" | "guest" | "admin" | "payment" | "line";

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
  | "guest.preorder_submitted"
  | "preorder.cancelled"
  | "preorder.reconfirmation_required"
  | "reservation.transitioned"
  | "guest.cancel_ok"
  | "guest.cancel_blocked"
  | "guest.refund_requested"
  | "admin.payment_approved"
  | "admin.payment_rejected"
  | "admin.waitlist_expired"
  | "admin.waitlist_staff_called"
  | "admin.reservation_extended"
  | "admin.room_checked_out"
  | "admin.room_checkout_side_effect_failed"
  | "payment.intent_created"
  | "payment.deposit_confirmed"
  | "payment.approved_notified"
  | "line.provider_rejected"
  | "payment.refund_processed"
  | "stripe.signature_failed"
  | "stripe.payment_intent_succeeded"
  | "stripe.payment_intent_failed"
  | "stripe.charge_refunded"
  | "stripe.event_unhandled"
  | "stripe.webhook_error";

export type AdminPaymentInteraction = "keyboard" | "click";

export type OpsLogScheduler = (work: () => Promise<void>) => void;

type PersistenceFailureReason =
  | "not_configured"
  | "missing_table"
  | "timeout_outcome_unknown"
  | "outcome_unknown"
  | "rejected"
  | "scheduler_unavailable";

const OPS_LOG_INSERT_TIMEOUT_MS = 3_000;

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
  detail: Record<string, unknown>,
  schedule?: OpsLogScheduler
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
  const persist = async () => {
    try {
      await persistOpsEvent(domain, action, detail);
    } catch (error) {
      reportPersistenceFailure(domain, action, classifyPersistenceFailure(error));
    }
  };

  try {
    // App Router requests use Next's lifecycle hook. Middleware supplies its
    // NextFetchEvent.waitUntil scheduler because it runs outside after() context.
    if (schedule) schedule(persist);
    else after(persist);
  } catch {
    reportPersistenceFailure(domain, action, "scheduler_unavailable");
  }
}

async function persistOpsEvent(
  domain: OpsLogDomain,
  action: OpsLogAction,
  detail: Record<string, unknown>
): Promise<void> {
  if (!isAdminConfigured() || !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    throw new PersistenceFailure("not_configured");
  }
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(OPS_LOG_INSERT_TIMEOUT_MS) }),
      },
    }
  );
  let result: { error: unknown; status: number };
  try {
    result = await db.from("ops_events").insert({ domain, action, detail });
  } catch (cause) {
    const reason = classifyPersistenceFailure(cause);
    throw new PersistenceFailure(
      reason === "timeout_outcome_unknown" ? reason : "outcome_unknown"
    );
  }
  if (result.error) {
    throw new PostgrestResponseFailure(result.error, result.status);
  }
}

class PersistenceFailure extends Error {
  constructor(readonly reason: PersistenceFailureReason) {
    super(reason);
  }
}

class PostgrestResponseFailure extends Error {
  constructor(
    readonly responseError: unknown,
    readonly status: number
  ) {
    super("PostgREST returned an error response");
  }
}

function classifyPersistenceFailure(error: unknown): PersistenceFailureReason {
  if (error instanceof PersistenceFailure) return error.reason;
  const response = error instanceof PostgrestResponseFailure ? error : undefined;
  const candidate = (response?.responseError ?? error) as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  const status = response?.status ?? Number((error as { status?: unknown } | null)?.status);
  if (code === "PGRST205" || code === "42P01") return "missing_table";
  if (
    code === "PGRST003" ||
    code === "57014" ||
    code === "ETIMEDOUT" ||
    candidate?.name === "TimeoutError" ||
    candidate?.name === "AbortError" ||
    /timed?\s*out|timeout/i.test(message)
  ) {
    return "timeout_outcome_unknown";
  }
  if (status === 0) return "outcome_unknown";
  if (code === "42501" || code.startsWith("23")) return "rejected";
  if (status >= 400 && status < 500 && status !== 408) return "rejected";
  return "outcome_unknown";
}

function reportPersistenceFailure(
  domain: OpsLogDomain,
  action: OpsLogAction,
  reason: PersistenceFailureReason
): void {
  // Keep this signal deliberately metadata-only: database errors can contain
  // SQL, request details, or customer-provided values.
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "ops_events.persistence_issue",
      reason,
      domain,
      action,
    })
  );
}
