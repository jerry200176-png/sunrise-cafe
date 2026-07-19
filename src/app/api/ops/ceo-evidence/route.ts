import { NextRequest, NextResponse } from "next/server";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { isValidCtoBearer } from "@/lib/cto-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";
import {
  buildCeoEvidence,
  rateWithDenominator,
} from "@/lib/ceo-evidence-contract";
import { fetchProductionVersion } from "@/lib/production-version";
import { findSuccessfulSendLineRunToday, isJobRunsTableReady } from "@/lib/job-runs";

/**
 * Unified CEO evidence contract.
 * Auth: CTO bearer OR cron authorization. Never embeds PII/secrets.
 * Access failures must not look like zero activity.
 */
export async function GET(request: NextRequest) {
  const cron = authorizeCronGet(request);
  const authorized = isValidCtoBearer(request) || cron.ok;
  if (!authorized) {
    const contract = buildCeoEvidence({
      sha: null,
      verified: false,
      health_ok: false,
      authorized: false,
      collected: false,
      outcomes: {},
    });
    return NextResponse.json(contract, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const prod = await fetchProductionVersion();
  let outcomes: Record<string, number | string | boolean | null> = {};
  let collected = false;
  let healthOk = true;
  try {
    const snap = await collectOutcomeMetrics();
    collected = snap.status === "ok" || snap.status === "degraded";
    healthOk = snap.deployment.health_ok === true;
    const depositNum = snap.payment.deposit_paid_30d;
    const depositDen = snap.payment.deposit_eligible_30d;
    const bookDen = snap.booking.bookings_30d + snap.booking.cancellation_count_30d;
    const sendLine = snap.cron.jobs.find((j) => j.job_name === "send-line");
    outcomes = {
      booking_started: bookDen,
      booking_completed: snap.booking.bookings_30d,
      booking_completion_numerator: snap.booking.bookings_30d,
      booking_completion_denominator: bookDen,
      booking_completion_rate: rateWithDenominator(snap.booking.bookings_30d, bookDen),
      deposit_required: depositDen,
      deposit_completed: depositNum,
      deposit_completion_numerator: depositNum,
      deposit_completion_denominator: depositDen,
      deposit_completion_rate:
        typeof snap.payment.deposit_rate_pct === "number"
          ? snap.payment.deposit_rate_pct / 100
          : rateWithDenominator(depositNum, depositDen),
      reminder_runs_expected: 7,
      reminder_runs_executed: sendLine?.runs_7d ?? null,
      reminder_runs_accepted:
        sendLine != null ? sendLine.runs_7d - sendLine.failed_7d : null,
      reminder_failure_count: sendLine?.failed_7d ?? null,
      zero_booking_days: bookDen === 0 ? 1 : 0,
      outcome_data_freshness: snap.collected_at,
      evidence_based_decisions: snap.status === "ok" ? 1 : 0,
      payment_mode: "line_deposit_screenshot",
      stripe_enabled: false,
      outcome_pipeline_status: snap.status,
      bookings_7d: snap.booking.bookings_7d,
      bookings_30d: snap.booking.bookings_30d,
    };
  } catch {
    collected = false;
  }

  let reminderFreshnessHours: number | null = null;
  let reminderExecuted: number | null = null;
  const reminderFailed: number | null = null;
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
    health_ok: healthOk,
    authorized: true,
    collected,
    outcomes,
    reminder: {
      executed: reminderExecuted ?? undefined,
      accepted: reminderExecuted ?? undefined,
      failed: reminderFailed ?? undefined,
      freshness_hours: reminderFreshnessHours,
    },
  });

  return NextResponse.json(contract, { headers: { "Cache-Control": "no-store" } });
}
