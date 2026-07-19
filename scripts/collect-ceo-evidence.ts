#!/usr/bin/env npx tsx
/**
 * Operator / Actions collector — PII-free CEO evidence from Supabase service role.
 * Secrets stay in Actions or local env; never printed.
 *
 * Usage:
 *   npx tsx scripts/collect-ceo-evidence.ts [out.json]
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import { writeFileSync } from "fs";
import { collectOutcomeMetrics } from "../src/lib/outcome-metrics";
import {
  buildCeoEvidence,
  rateWithDenominator,
} from "../src/lib/ceo-evidence-contract";
import { fetchProductionVersion } from "../src/lib/production-version";
import { findSuccessfulSendLineRunToday, isJobRunsTableReady } from "../src/lib/job-runs";
import { isAdminConfigured } from "../src/lib/supabase-admin";

async function main() {
  const outPath = process.argv[2] ?? "orchestrator/ceo-evidence.json";
  const authorized = isAdminConfigured();

  if (!authorized) {
    const contract = buildCeoEvidence({
      sha: null,
      verified: false,
      health_ok: false,
      authorized: false,
      collected: false,
      outcomes: {},
      risks: ["service_role_not_configured"],
    });
    writeFileSync(outPath, JSON.stringify(contract, null, 2) + "\n");
    console.error(`ceo-evidence: unauthorized (no service role) → ${outPath}`);
    process.exit(2);
  }

  const prod = await fetchProductionVersion();
  const snap = await collectOutcomeMetrics({
    repositoryCommit: process.env.GITHUB_SHA ?? null,
  });
  const collected = snap.status === "ok" || snap.status === "degraded";

  const depositNum = snap.payment.deposit_paid_30d;
  const depositDen = snap.payment.deposit_eligible_30d;
  const bookDen = snap.booking.bookings_30d + snap.booking.cancellation_count_30d;
  const sendLine = snap.cron.jobs.find((j) => j.job_name === "send-line");

  const outcomes: Record<string, number | string | boolean | null> = {
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
    source: "actions-service-role",
  };

  let reminderFreshnessHours: number | null = null;
  let reminderExecuted: number | null = null;
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
    health_ok: snap.deployment.health_ok === true,
    authorized: true,
    collected,
    outcomes,
    reminder: {
      executed: reminderExecuted ?? undefined,
      accepted: reminderExecuted ?? undefined,
      freshness_hours: reminderFreshnessHours,
    },
  });

  writeFileSync(outPath, JSON.stringify(contract, null, 2) + "\n");
  console.log(
    JSON.stringify({
      outcome_access: contract.outcome_access,
      evidence_confidence: contract.evidence_confidence,
      bookings_7d: outcomes.bookings_7d,
      bookings_30d: outcomes.bookings_30d,
      deposit_completion_rate: outcomes.deposit_completion_rate,
      out: outPath,
    })
  );
  if (contract.outcome_access === "unavailable" || contract.outcome_access === "unauthorized") {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("ceo-evidence collect failed:", (err as Error).message);
  process.exit(1);
});
