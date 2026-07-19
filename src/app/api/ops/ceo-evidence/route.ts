import { NextRequest, NextResponse } from "next/server";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { isValidCtoBearer } from "@/lib/cto-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";
import { buildCeoEvidence } from "@/lib/ceo-evidence-contract";
import { fetchProductionVersion } from "@/lib/production-version";
import { findSuccessfulSendLineRunToday, isJobRunsTableReady } from "@/lib/job-runs";

/**
 * Unified CEO evidence contract (Phase 1).
 * Auth: CTO bearer OR cron authorization. Never embeds PII/secrets.
 */
export async function GET(request: NextRequest) {
  const cron = authorizeCronGet(request);
  const ok = isValidCtoBearer(request) || cron.ok;
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prod = await fetchProductionVersion();
  let outcomes: Record<string, number | string | boolean | null> = {};
  let snapshotStatus: string | null = null;
  try {
    const snap = await collectOutcomeMetrics();
    snapshotStatus = snap.status;
    const depositNum = snap.payment.deposit_paid_30d;
    const depositDen = snap.payment.deposit_eligible_30d;
    const bookDen = snap.booking.bookings_30d + snap.booking.cancellation_count_30d;
    outcomes = {
      booking_started: bookDen,
      booking_completed: snap.booking.bookings_30d,
      booking_completion_numerator: snap.booking.bookings_30d,
      booking_completion_denominator: bookDen,
      booking_completion_rate:
        bookDen > 0 ? Math.round((snap.booking.bookings_30d / bookDen) * 1000) / 1000 : null,
      deposit_required: depositDen,
      deposit_completed: depositNum,
      deposit_completion_numerator: depositNum,
      deposit_completion_denominator: depositDen,
      deposit_completion_rate: snap.payment.deposit_rate_pct,
      reminder_runs_expected: 1,
      reminder_runs_executed: snap.cron.jobs.find((j) => j.job_name === "send-line")?.runs_7d ?? null,
      reminder_runs_accepted:
        snap.cron.jobs.find((j) => j.job_name === "send-line")?.runs_7d != null
          ? (snap.cron.jobs.find((j) => j.job_name === "send-line")!.runs_7d -
              snap.cron.jobs.find((j) => j.job_name === "send-line")!.failed_7d)
          : null,
      reminder_failure_count:
        snap.cron.jobs.find((j) => j.job_name === "send-line")?.failed_7d ?? null,
      zero_booking_days: null,
      outcome_data_freshness: snap.collected_at,
      evidence_based_decisions: snap.status === "ok" ? 1 : 0,
      stripe_enabled: snap.deployment.health_ok ? false : null,
      payment_mode: "line_deposit_screenshot",
      outcome_pipeline_status: snap.status,
    };
  } catch {
    snapshotStatus = "unavailable";
  }

  let reminderFreshnessHours: number | null = null;
  let reminderExecuted: number | null = null;
  let reminderFailed: number | null = null;
  try {
    if (await isJobRunsTableReady()) {
      const prior = await findSuccessfulSendLineRunToday();
      reminderExecuted = prior ? 1 : 0;
      if (prior?.started_at) {
        reminderFreshnessHours =
          (Date.now() - new Date(prior.started_at).getTime()) / (1000 * 60 * 60);
      }
    }
  } catch {
    /* leave null */
  }

  const contract = buildCeoEvidence({
    sha: prod.commit,
    verified: prod.reachable && Boolean(prod.commit),
    health_ok: true,
    outcomes,
    reminder: {
      executed: reminderExecuted ?? undefined,
      accepted: reminderExecuted ?? undefined,
      failed: reminderFailed ?? undefined,
      freshness_hours: reminderFreshnessHours,
    },
    risks: snapshotStatus === "unavailable" ? ["outcome_metrics_unavailable"] : [],
  });

  return NextResponse.json(contract, { headers: { "Cache-Control": "no-store" } });
}
