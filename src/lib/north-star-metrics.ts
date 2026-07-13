/**
 * North Star Metrics — Observed vs Target with Delta and Trend.
 */
import type { OutcomeSnapshot } from "@/lib/outcome-metrics";
import { NORTH_STAR_TARGETS } from "@/lib/north-star-targets";

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

export type MetricTrend = {
  d7: number | null;
  d30: number | null;
  d90: number | null;
  note?: string;
};

export type NorthStarMetric = {
  id: NorthStarMetricId;
  name: string;
  /** @deprecated Use observed — kept for backward compatibility */
  value: number | null;
  observed: number | null;
  target: number;
  delta: number | null;
  unit: string;
  direction: MetricDirection;
  status: MetricStatus;
  trend: MetricTrend;
  source: string;
  target_rationale: string;
  last_updated: string;
  note?: string;
};

export type NorthStarSnapshot = {
  collected_at: string;
  metrics: NorthStarMetric[];
  measured_count: number;
  unmeasured_count: number;
};

function rateStatus(
  observed: number | null,
  target: number,
  direction: MetricDirection,
  tolerance = 0.1
): MetricStatus {
  if (observed == null) return "unmeasured";
  if (direction === "up") {
    if (observed >= target) return "on_track";
    if (observed >= target * (1 - tolerance)) return "at_risk";
    return "at_risk";
  }
  if (observed <= target) return "on_track";
  if (observed <= target * (1 + tolerance)) return "at_risk";
  return "at_risk";
}

/** Positive delta = moving toward target (good). */
export function calcMetricDelta(
  observed: number | null,
  target: number,
  direction: MetricDirection
): number | null {
  if (observed == null) return null;
  if (direction === "up") {
    return Math.round((observed - target) * 100) / 100;
  }
  return Math.round((target - observed) * 100) / 100;
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

const TREND_PENDING: MetricTrend = {
  d7: null,
  d30: null,
  d90: null,
  note: "Weekly snapshots required — see docs/internal/executive/WEEKLY_EXECUTIVE_REVIEW.md",
};

function metric(
  id: NorthStarMetricId,
  name: string,
  observed: number | null,
  source: string,
  collectedAt: string,
  trend?: Partial<MetricTrend>,
  note?: string
): NorthStarMetric {
  const def = NORTH_STAR_TARGETS[id];
  const trendMerged: MetricTrend = { ...TREND_PENDING, ...trend };
  const status = rateStatus(observed, def.target, def.direction);
  return {
    id,
    name,
    value: observed,
    observed,
    target: def.target,
    delta: calcMetricDelta(observed, def.target, def.direction),
    unit: def.unit,
    direction: def.direction,
    status,
    trend: trendMerged,
    source,
    target_rationale: def.rationale,
    last_updated: collectedAt,
    note,
  };
}

export function buildNorthStarSnapshot(snapshot: OutcomeSnapshot): NorthStarSnapshot {
  const collectedAt = snapshot.collected_at;
  const cronFailPct = calcCronFailureRate(snapshot.cron.jobs);
  const cancelPct =
    snapshot.booking.cancellation_rate_30d != null
      ? Math.round(snapshot.booking.cancellation_rate_30d * 1000) / 10
      : null;
  const supportProxy =
    snapshot.payment.pending_reviews + snapshot.payment.deposit_at_risk;

  const weeklyBookingPace =
    snapshot.booking.bookings_30d > 0
      ? Math.round((snapshot.booking.bookings_7d / (snapshot.booking.bookings_30d / 4.3)) * 100) / 100
      : null;

  const metrics: NorthStarMetric[] = [
    metric(
      "booking_conversion",
      "Booking Conversion",
      snapshot.funnel.booking_conversion_pct,
      "ops_events: booking_created / booking_flow_entered (7d)",
      collectedAt,
      { d7: snapshot.funnel.booking_conversion_pct },
      snapshot.funnel.ops_events_ready ? undefined : "Apply migration-ops-events.sql"
    ),
    metric(
      "deposit_conversion",
      "Deposit Conversion",
      snapshot.payment.deposit_rate_pct,
      "outcome-pipeline: payment.deposit_rate_pct",
      collectedAt,
      { d30: snapshot.payment.deposit_rate_pct }
    ),
    metric(
      "waitlist_conversion",
      "Waitlist Conversion",
      snapshot.waitlist.conversion_pct,
      "outcome-pipeline: waitlist.conversion_pct",
      collectedAt,
      { d30: snapshot.waitlist.conversion_pct }
    ),
    metric("avg_booking_time", "Average Booking Time", null, "ops-log timestamps (not yet aggregated)", collectedAt),
    metric(
      "payment_completion_rate",
      "Payment Completion Rate",
      snapshot.funnel.payment_completion_pct,
      "ops_events: payment clicks / deposit_instructions_viewed (7d)",
      collectedAt,
      { d7: snapshot.funnel.payment_completion_pct },
      snapshot.funnel.ops_events_ready ? undefined : "Apply migration-ops-events.sql"
    ),
    metric(
      "admin_payment_review_sla",
      "Payment Review SLA (% within 4h)",
      snapshot.payment.payment_review_sla_compliance_pct_7d,
      "outcome-pipeline: payment_review_sla_compliance_pct_7d",
      collectedAt,
      { d7: snapshot.payment.payment_review_sla_compliance_pct_7d },
      snapshot.payment.payment_review_oldest_hours != null
        ? `Oldest pending: ${snapshot.payment.payment_review_oldest_hours}h`
        : undefined
    ),
    metric(
      "admin_keyboard_adoption",
      "Keyboard Approval Adoption",
      snapshot.funnel.keyboard_adoption_pct,
      "ops_events: keyboard / payment_approved (7d)",
      collectedAt,
      { d7: snapshot.funnel.keyboard_adoption_pct },
      snapshot.funnel.ops_events_ready ? undefined : "Apply migration-ops-events.sql"
    ),
    metric(
      "customer_support_proxy",
      "Support Load Proxy",
      supportProxy,
      "pending_reviews + deposit_at_risk",
      collectedAt,
      { d7: supportProxy }
    ),
    metric(
      "production_error_rate",
      "Production Error Rate (cron 7d)",
      cronFailPct,
      "outcome-pipeline: cron job runs",
      collectedAt,
      { d7: cronFailPct }
    ),
    metric(
      "cancellation_rate",
      "Cancellation Rate",
      cancelPct,
      "outcome-pipeline: booking.cancellation_rate_30d",
      collectedAt,
      { d30: cancelPct }
    ),
    metric(
      "core_web_vitals_lcp",
      "Core Web Vitals LCP",
      null,
      "RUM / Lighthouse CI (not wired)",
      collectedAt
    ),
    metric(
      "api_latency_p95",
      "API Latency P95",
      null,
      "Vercel logs / middleware (not wired)",
      collectedAt
    ),
  ];

  // Attach booking volume pace as contextual trend note on booking_conversion when unmeasured
  const bookingMetric = metrics.find((m) => m.id === "booking_conversion");
  if (bookingMetric && weeklyBookingPace != null) {
    bookingMetric.trend.note = `Booking volume pace (7d/30d): ${weeklyBookingPace}x — conversion ratio pending ops-log aggregation`;
  }

  const measured = metrics.filter((m) => m.status !== "unmeasured").length;

  return {
    collected_at: collectedAt,
    metrics,
    measured_count: measured,
    unmeasured_count: metrics.length - measured,
  };
}
