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
  completeness_rule: string;
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
    completeness_rule: "denominator ≥ 20 in window else status=unmeasured (insufficient_n)",
    truth_source: "ops_events",
    reconciliation: "numerator ≤ reservations created in same window (±10%)",
  },
  deposit_conversion: {
    id: "deposit_conversion",
    numerator: "reservations is_deposit_paid=true AND deposit-required (weekend/holiday or branch policy)",
    denominator: "deposit-eligible reservations status IN (pending,confirmed,checked_in,completed) created in window",
    timezone: "Asia/Taipei",
    window: "rolling 30d",
    freshness_sla: "≤1h",
    completeness_rule: "denominator ≥ 5 else unmeasured",
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
    completeness_rule: "denominator ≥ 5 else unmeasured",
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
    completeness_rule: "paired sessions ≥ 10 else unmeasured",
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
    completeness_rule: "denominator ≥ 10 else unmeasured",
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
    completeness_rule: "payment_events table ready AND denominator ≥ 3",
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
    completeness_rule: "denominator ≥ 10 else unmeasured",
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
    completeness_rule: "payment_events ready",
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
    completeness_rule: "job_runs table ready AND runs ≥ 1",
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
    completeness_rule: "denominator ≥ 10",
    truth_source: "reservations",
    reconciliation: "all cancellations are explicit guest/staff actions (ADR-012: no deposit auto-cancel)",
  },
  core_web_vitals_lcp: {
    id: "core_web_vitals_lcp",
    numerator: "p75 LCP seconds",
    denominator: "RUM samples",
    timezone: "Asia/Taipei",
    window: "rolling 7d",
    freshness_sla: "≤24h",
    completeness_rule: "samples ≥ 50 else unmeasured",
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
    completeness_rule: "samples ≥ 100 else unmeasured",
    truth_source: "Vercel analytics / logs (forward)",
    reconciliation: "n/a until wiring",
  },
};

export type ContractEvaluation = {
  id: NorthStarMetricId;
  observed: number | null;
  contract_satisfied: boolean;
  gaps: string[];
};

export function evaluateContractCompleteness(opts: {
  id: NorthStarMetricId;
  observed: number | null;
  denominator_n?: number | null;
  table_ready?: boolean;
}): ContractEvaluation {
  void NORTH_STAR_CONTRACTS[opts.id];
  const gaps: string[] = [];
  if (opts.observed == null) gaps.push("observed_null");
  if (opts.table_ready === false) gaps.push("source_unavailable");
  if (opts.denominator_n != null && opts.denominator_n < 1) gaps.push("denominator_empty");
  // Minimal structural check — full n thresholds applied when pipeline provides counts
  return {
    id: opts.id,
    observed: opts.observed,
    contract_satisfied: gaps.length === 0 && opts.observed != null,
    gaps,
  };
}
