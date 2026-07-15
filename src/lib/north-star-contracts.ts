/**
 * North Star metric contracts — numerator/denominator/timezone/window/
 * freshness/completeness + reconciliation source.
 * A-grade requires Observed values that satisfy these contracts — not merely non-null.
 */
import type { NorthStarMetricId } from "@/lib/north-star-metrics";

export type MetricContract = {
  id: NorthStarMetricId;
  numerator: string;
  denominator: string;
  /** Primary reporting timezone or storage timezone note */
  timezone: "Asia/Taipei" | "UTC" | string;
  window: string;
  freshness_sla: string;
  /** Minutes for freshness_sla machine check (null = no clock check yet) */
  freshness_sla_minutes: number | null;
  completeness_rule: string;
  /** Minimum denominator_n before contract can be satisfied */
  min_denominator_n: number;
  truth_source: string;
  reconciliation: string;
};

export const NORTH_STAR_CONTRACTS: Record<NorthStarMetricId, MetricContract> = {
  booking_conversion: {
    id: "booking_conversion",
    numerator: "ops_events guest.booking_submit_success (distinct session approx by IP-day)",
    denominator: "ops_events guest.booking_flow_entered",
    timezone: "Asia/Taipei",
    window: "rolling 7d / 30d",
    freshness_sla: "≤15m from last ops_events row",
    freshness_sla_minutes: 15,
    completeness_rule: "denominator ≥ 20 in window else status=unmeasured (insufficient_n)",
    min_denominator_n: 20,
    truth_source: "ops_events",
    reconciliation: "numerator ≤ reservations created in same window (±10%)",
  },
  deposit_conversion: {
    id: "deposit_conversion",
    numerator: "reservations is_deposit_paid=true AND deposit-required (weekend/holiday or branch policy)",
    denominator: "deposit-eligible reservations status IN (pending,confirmed,reserved,checked_in,completed) created in window",
    timezone: "Asia/Taipei",
    window: "rolling 30d",
    freshness_sla: "≤1h",
    freshness_sla_minutes: 60,
    completeness_rule: "denominator ≥ 5 else unmeasured",
    min_denominator_n: 5,
    truth_source: "reservations",
    reconciliation: "paid count ≥ count(payment_events status=approved) − refunds (±2)",
  },
  waitlist_conversion: {
    id: "waitlist_conversion",
    numerator: "waitlist rows status progressed to booked/confirmed reservation",
    denominator: "waitlist joined in window",
    timezone: "Asia/Taipei",
    window: "rolling 30d",
    freshness_sla: "≤1h",
    freshness_sla_minutes: 60,
    completeness_rule: "denominator ≥ 5 else unmeasured",
    min_denominator_n: 5,
    truth_source: "waitlist + reservations",
    reconciliation: "converted ids must exist in reservations",
  },
  avg_booking_time: {
    id: "avg_booking_time",
    numerator: "median(ms between booking_flow_entered and booking_submit_success)",
    denominator: "paired funnel sessions with both events",
    timezone: "Asia/Taipei",
    window: "rolling 7d",
    freshness_sla: "≤15m",
    freshness_sla_minutes: 15,
    completeness_rule: "paired sessions ≥ 10 else unmeasured",
    min_denominator_n: 10,
    truth_source: "ops_events",
    reconciliation: "p50 within [0.5m, 30m] else flag data_quality",
  },
  payment_completion_rate: {
    id: "payment_completion_rate",
    numerator: "guest.payment_line_pay_click + guest.payment_line_official_click",
    denominator: "guest.deposit_instructions_viewed",
    timezone: "Asia/Taipei",
    window: "rolling 7d",
    freshness_sla: "≤15m",
    freshness_sla_minutes: 15,
    completeness_rule: "denominator ≥ 10 else unmeasured",
    min_denominator_n: 10,
    truth_source: "ops_events",
    reconciliation: "clicks ≤ views",
  },
  admin_payment_review_sla: {
    id: "admin_payment_review_sla",
    numerator: "payment_events reviewed within 4h (reviewed_at - created_at ≤ 4h)",
    denominator: "payment_events reaching terminal status in window",
    timezone: "Asia/Taipei",
    window: "rolling 7d",
    freshness_sla: "≤15m",
    freshness_sla_minutes: 15,
    completeness_rule: "payment_events table ready AND denominator ≥ 3",
    min_denominator_n: 3,
    truth_source: "payment_events",
    reconciliation: "pending queue age matches oldest pending_review",
  },
  admin_keyboard_adoption: {
    id: "admin_keyboard_adoption",
    numerator: "admin payment approve/reject with interaction=keyboard",
    denominator: "all admin payment approve/reject",
    timezone: "Asia/Taipei",
    window: "rolling 14d",
    freshness_sla: "≤1h",
    freshness_sla_minutes: 60,
    completeness_rule: "denominator ≥ 10 else unmeasured",
    min_denominator_n: 10,
    truth_source: "ops_events",
    reconciliation: "n/a",
  },
  customer_support_proxy: {
    id: "customer_support_proxy",
    numerator: "pending_payment_reviews + deposit_at_risk",
    denominator: "1 (count metric)",
    timezone: "Asia/Taipei",
    window: "point-in-time",
    freshness_sla: "≤15m",
    freshness_sla_minutes: 15,
    completeness_rule: "payment_events ready",
    min_denominator_n: 1,
    truth_source: "payment_events + reservations",
    reconciliation: "pending = count status=pending_review",
  },
  production_error_rate: {
    id: "production_error_rate",
    numerator: "job_runs failed_7d sum",
    denominator: "job_runs runs_7d sum",
    timezone: "UTC (job timestamps) displayed Taipei",
    window: "rolling 7d",
    freshness_sla: "≤6h (cron cadence)",
    freshness_sla_minutes: 360,
    completeness_rule: "job_runs table ready AND runs ≥ 1",
    min_denominator_n: 1,
    truth_source: "job_runs",
    reconciliation: "matches vercel cron invocations ±1/day/job",
  },
  cancellation_rate: {
    id: "cancellation_rate",
    numerator: "reservations status=cancelled created in window",
    denominator: "all reservations created in window",
    timezone: "Asia/Taipei",
    window: "rolling 30d",
    freshness_sla: "≤1h",
    freshness_sla_minutes: 60,
    completeness_rule: "denominator ≥ 10",
    min_denominator_n: 10,
    truth_source: "reservations",
    reconciliation: "auto-release cancel subset ≤ deposit-deadline job outcomes",
  },
  core_web_vitals_lcp: {
    id: "core_web_vitals_lcp",
    numerator: "p75 LCP seconds",
    denominator: "RUM samples",
    timezone: "Asia/Taipei",
    window: "rolling 7d",
    freshness_sla: "≤24h",
    freshness_sla_minutes: 1440,
    completeness_rule: "samples ≥ 50 else unmeasured",
    min_denominator_n: 50,
    truth_source: "web-vitals / analytics (forward)",
    reconciliation: "n/a until RUM wired",
  },
  api_latency_p95: {
    id: "api_latency_p95",
    numerator: "p95 latency ms for /api/admin/*",
    denominator: "request samples",
    timezone: "UTC",
    window: "rolling 7d",
    freshness_sla: "≤24h",
    freshness_sla_minutes: 1440,
    completeness_rule: "samples ≥ 100 else unmeasured",
    min_denominator_n: 100,
    truth_source: "Vercel analytics / logs (forward)",
    reconciliation: "n/a until wiring",
  },
};

export type ContractEvaluation = {
  id: NorthStarMetricId;
  observed: number | null;
  contract_satisfied: boolean;
  /** True only when non-null AND completeness/freshness/recon gates pass */
  a_grade_eligible: boolean;
  gaps: string[];
  alerts: string[];
};

/**
 * Evaluate contract — observed != null alone NEVER yields contract_satisfied.
 */
export function evaluateContractCompleteness(opts: {
  id: NorthStarMetricId;
  observed: number | null;
  denominator_n?: number | null;
  table_ready?: boolean;
  /** ISO timestamp of freshest source row */
  source_fresh_at?: string | null;
  now?: Date;
  /** Reconciliation residual absolute error; null = not checked */
  reconciliation_delta?: number | null;
  reconciliation_tolerance?: number;
  /** Duplicate / data-quality flags from pipeline */
  duplicate_rate?: number | null;
  max_duplicate_rate?: number;
}): ContractEvaluation {
  const contract = NORTH_STAR_CONTRACTS[opts.id];
  const gaps: string[] = [];
  const alerts: string[] = [];
  const now = opts.now ?? new Date();

  if (opts.observed == null) gaps.push("observed_null");
  if (opts.table_ready === false) gaps.push("source_unavailable");

  const den = opts.denominator_n;
  if (den == null) {
    gaps.push("denominator_unmeasured");
  } else if (den < contract.min_denominator_n) {
    gaps.push("insufficient_n");
    alerts.push(
      `${opts.id}: denominator_n=${den} < min=${contract.min_denominator_n} — do not claim A`
    );
  }

  if (contract.freshness_sla_minutes != null) {
    if (!opts.source_fresh_at) {
      gaps.push("freshness_unknown");
    } else {
      const freshMs = new Date(opts.source_fresh_at).getTime();
      if (Number.isNaN(freshMs)) {
        gaps.push("freshness_invalid");
      } else {
        const ageMin = (now.getTime() - freshMs) / 60_000;
        if (ageMin > contract.freshness_sla_minutes) {
          gaps.push("stale");
          alerts.push(
            `${opts.id}: source age ${ageMin.toFixed(1)}m > SLA ${contract.freshness_sla_minutes}m`
          );
        }
      }
    }
  }

  if (opts.reconciliation_delta != null) {
    const tol = opts.reconciliation_tolerance ?? 0;
    if (Math.abs(opts.reconciliation_delta) > tol) {
      gaps.push("reconciliation_failed");
      alerts.push(
        `${opts.id}: reconciliation delta ${opts.reconciliation_delta} exceeds tol ${tol}`
      );
    }
  } else if (contract.reconciliation !== "n/a" && !contract.reconciliation.startsWith("n/a")) {
    // Not yet measured — block A, not B
    gaps.push("reconciliation_unverified");
  }

  const maxDup = opts.max_duplicate_rate ?? 0.05;
  if (opts.duplicate_rate != null && opts.duplicate_rate > maxDup) {
    gaps.push("duplicate_contamination");
    alerts.push(`${opts.id}: duplicate_rate=${opts.duplicate_rate} > ${maxDup}`);
  }

  const contract_satisfied = gaps.length === 0;
  return {
    id: opts.id,
    observed: opts.observed,
    contract_satisfied,
    a_grade_eligible: contract_satisfied,
    gaps,
    alerts,
  };
}

/** Gating metrics that must be satisfied for A-grade on D07 */
export const A_GRADE_GATING_METRIC_IDS: NorthStarMetricId[] = [
  "booking_conversion",
  "deposit_conversion",
  "payment_completion_rate",
  "admin_payment_review_sla",
  "cancellation_rate",
];
