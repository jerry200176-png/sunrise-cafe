/**
 * North Star Metrics — maps Outcome Pipeline + targets into comparable product KPIs.
 */
import type { OutcomeSnapshot } from "@/lib/outcome-metrics";

export type MetricDirection = "up" | "down";
export type MetricStatus = "on_track" | "at_risk" | "unmeasured";

export type NorthStarMetricId =
  | "booking_conversion"
  | "deposit_conversion"
  | "waitlist_conversion"
  | "avg_booking_time"
  | "payment_completion_rate"
  | "admin_payment_review_sla"
  | "admin_keyboard_adoption"
  | "customer_support_proxy"
  | "production_error_rate"
  | "cancellation_rate"
  | "core_web_vitals_lcp"
  | "api_latency_p95";

export type NorthStarMetric = {
  id: NorthStarMetricId;
  name: string;
  value: number | null;
  unit: string;
  target: number;
  direction: MetricDirection;
  status: MetricStatus;
  source: string;
  note?: string;
};

export type NorthStarSnapshot = {
  collected_at: string;
  metrics: NorthStarMetric[];
  measured_count: number;
  unmeasured_count: number;
};

function rateStatus(
  value: number | null,
  target: number,
  direction: MetricDirection,
  tolerance = 0.1
): MetricStatus {
  if (value == null) return "unmeasured";
  if (direction === "up") {
    if (value >= target) return "on_track";
    if (value >= target * (1 - tolerance)) return "at_risk";
    return "at_risk";
  }
  if (value <= target) return "on_track";
  if (value <= target * (1 + tolerance)) return "at_risk";
  return "at_risk";
}

/** Cron failure rate across scheduled jobs (7d). */
export function calcCronFailureRate(jobs: OutcomeSnapshot["cron"]["jobs"]): number | null {
  let runs = 0;
  let failed = 0;
  for (const j of jobs) {
    runs += j.runs_7d;
    failed += j.failed_7d;
  }
  if (runs <= 0) return null;
  return Math.round((failed / runs) * 10000) / 100;
}

export function buildNorthStarSnapshot(snapshot: OutcomeSnapshot): NorthStarSnapshot {
  const cronFailPct = calcCronFailureRate(snapshot.cron.jobs);
  const cancelPct =
    snapshot.booking.cancellation_rate_30d != null
      ? Math.round(snapshot.booking.cancellation_rate_30d * 1000) / 10
      : null;
  const supportProxy =
    snapshot.payment.pending_reviews + snapshot.payment.deposit_at_risk;

  const metrics: NorthStarMetric[] = [
    {
      id: "booking_conversion",
      name: "Booking Conversion",
      value: null,
      unit: "%",
      target: 65,
      direction: "up",
      status: "unmeasured",
      source: "ops-log: booking_flow_entered / booking_created",
      note: "Telemetry added; ratio computed after 7d log volume",
    },
    {
      id: "deposit_conversion",
      name: "Deposit Conversion",
      value: snapshot.payment.deposit_rate_pct,
      unit: "%",
      target: 85,
      direction: "up",
      status: rateStatus(snapshot.payment.deposit_rate_pct, 85, "up"),
      source: "outcome-pipeline: payment.deposit_rate_pct",
    },
    {
      id: "waitlist_conversion",
      name: "Waitlist Conversion",
      value: snapshot.waitlist.conversion_pct,
      unit: "%",
      target: 30,
      direction: "up",
      status: rateStatus(snapshot.waitlist.conversion_pct, 30, "up"),
      source: "outcome-pipeline: waitlist.conversion_pct",
    },
    {
      id: "avg_booking_time",
      name: "Average Booking Time",
      value: null,
      unit: "min",
      target: 5,
      direction: "down",
      status: "unmeasured",
      source: "ops-log timestamps (not yet aggregated)",
    },
    {
      id: "payment_completion_rate",
      name: "Payment Completion Rate",
      value: null,
      unit: "%",
      target: 70,
      direction: "up",
      status: "unmeasured",
      source: "ops-log: deposit_instructions_viewed / payment_*_click",
      note: "Telemetry added; ratio after deploy",
    },
    {
      id: "admin_payment_review_sla",
      name: "Payment Review SLA (oldest h)",
      value: snapshot.payment.payment_review_oldest_hours,
      unit: "h",
      target: 4,
      direction: "down",
      status: rateStatus(snapshot.payment.payment_review_oldest_hours, 4, "down", 0.25),
      source: "outcome-pipeline: payment_review_oldest_hours",
    },
    {
      id: "admin_keyboard_adoption",
      name: "Keyboard Approval Adoption",
      value: null,
      unit: "%",
      target: 30,
      direction: "up",
      status: "unmeasured",
      source: "ops-log: admin.payment_approved interaction=keyboard",
      note: "Telemetry added; ratio after staff adoption period",
    },
    {
      id: "customer_support_proxy",
      name: "Support Load Proxy",
      value: supportProxy,
      unit: "count",
      target: 5,
      direction: "down",
      status: rateStatus(supportProxy, 5, "down", 0.4),
      source: "pending_reviews + deposit_at_risk",
    },
    {
      id: "production_error_rate",
      name: "Production Error Rate (cron 7d)",
      value: cronFailPct,
      unit: "%",
      target: 1,
      direction: "down",
      status: rateStatus(cronFailPct, 1, "down", 0.5),
      source: "outcome-pipeline: cron job runs",
    },
    {
      id: "cancellation_rate",
      name: "Cancellation Rate",
      value: cancelPct,
      unit: "%",
      target: 15,
      direction: "down",
      status: rateStatus(cancelPct, 15, "down"),
      source: "outcome-pipeline: booking.cancellation_rate_30d",
    },
    {
      id: "core_web_vitals_lcp",
      name: "Core Web Vitals LCP",
      value: null,
      unit: "s",
      target: 2.5,
      direction: "down",
      status: "unmeasured",
      source: "RUM / Lighthouse CI (not wired)",
    },
    {
      id: "api_latency_p95",
      name: "API Latency P95",
      value: null,
      unit: "ms",
      target: 500,
      direction: "down",
      status: "unmeasured",
      source: "Vercel logs / middleware (not wired)",
    },
  ];

  const measured = metrics.filter((m) => m.status !== "unmeasured").length;

  return {
    collected_at: snapshot.collected_at,
    metrics,
    measured_count: measured,
    unmeasured_count: metrics.length - measured,
  };
}
