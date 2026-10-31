import { describe, expect, it } from "vitest";
import { buildNorthStarSnapshot, calcMetricDelta, calcCronFailureRate } from "./north-star-metrics";
import { buildExecutiveReview } from "./executive-review";
import type { OutcomeSnapshot } from "./outcome-metrics";

function minimalSnapshot(overrides: Partial<OutcomeSnapshot> = {}): OutcomeSnapshot {
  return {
    collected_at: "2026-07-11T12:00:00.000Z",
    status: "ok",
    health_block: {
      date: "2026-07-11",
      deposit_rate_pct: 80,
      waitlist_conversion_pct: 25,
      payment_review_oldest_hours: 2,
      payment_review_sla_breached: false,
      migrations_all_applied: "yes",
      overlap_constraint_active: "yes",
      evidence_source: "test",
      reviewer: "test",
    },
    booking: {
      bookings_30d: 100,
      bookings_7d: 20,
      cancellation_rate_30d: 0.12,
      cancellation_count_30d: 12,
    },
    payment: {
      deposit_rate_pct: 80,
      deposit_paid_30d: 40,
      deposit_eligible_30d: 50,
      pending_reviews: 2,
      payment_review_oldest_hours: 2,
      payment_review_median_hours_7d: 1.5,
      payment_review_sla_compliance_pct_7d: 95,
      payment_events_ready: true,
      deposit_at_risk: 1,
    },
    cancellation: { cancelled_30d: 12, auto_release_proxy_7d: 1 },
    refund: { tracked: true, note: "", rejected_payments_7d: 0 },
    waitlist: { joined_30d: 10, converted_30d: 3, conversion_pct: 30 },
    cron: {
      scheduled_jobs: [],
      deposit_reminders_7d: 5,
      tomorrow_reminders_pending: 0,
      auto_releases_7d: 1,
      job_runs_ready: true,
      jobs: [{
        job_name: "test",
        last_status: "completed",
        last_started_at: "2026-07-11T11:00:00.000Z",
        last_finished_at: "2026-07-11T11:01:00.000Z",
        last_items_processed: 1,
        last_error: null,
        runs_7d: 100,
        failed_7d: 0,
      }],
    },
    deployment: {
      commit: "abc1234",
      live_commit: "abc1234",
      live_commit_short: "abc1234",
      repository_commit: "abc1234",
      sha_parity: true,
      production_reachable: true,
      health_ok: true,
      service_role_configured: true,
    },
    migrations: {
      schema_migrations_table: true,
      applied: [],
      pending: [],
      all_required_applied: true,
      overlap_constraint_active: true,
      closed_dates_column: true,
      rbac_tables: true,
    },
    support: { pending_payment_reviews: 2, rejected_events_7d: 0, note: "" },
    funnel: {
      ops_events_ready: true,
      booking_flow_entered_7d: 100,
      booking_created_7d: 80,
      booking_conversion_pct: 80,
      deposit_instructions_viewed_7d: 50,
      payment_clicks_7d: 40,
      payment_completion_pct: 80,
      payment_approved_7d: 10,
      payment_approved_keyboard_7d: 6,
      keyboard_adoption_pct: 60,
    },
    ...overrides,
  };
}

describe("calcMetricDelta", () => {
  it("positive when observed above target for up metrics", () => {
    expect(calcMetricDelta(90, 85, "up")).toBe(5);
  });

  it("positive when observed below target for down metrics", () => {
    expect(calcMetricDelta(2, 4, "down")).toBe(2);
  });
});

describe("calcCronFailureRate", () => {
  it("returns null when no runs", () => {
    expect(calcCronFailureRate([])).toBeNull();
  });
});

describe("buildNorthStarSnapshot", () => {
  it("includes observed, target, delta, and rationale", () => {
    const ns = buildNorthStarSnapshot(minimalSnapshot());
    const deposit = ns.metrics.find((m) => m.id === "deposit_conversion");
    expect(deposit?.observed).toBe(80);
    expect(deposit?.target).toBe(85);
    expect(deposit?.delta).toBe(-5);
    expect(deposit?.target_rationale).toContain("OUTCOME_LOG");
    expect(deposit?.last_updated).toBe("2026-07-11T12:00:00.000Z");
  });
});

describe("buildExecutiveReview", () => {
  it("generates markdown with top 10 ROI", () => {
    const ns = buildNorthStarSnapshot(minimalSnapshot());
    const review = buildExecutiveReview(ns);
    expect(review.top_10_roi).toHaveLength(10);
    expect(review.markdown).toContain("Weekly Executive Review");
    expect(review.hypotheses.pending.length).toBeGreaterThan(0);
  });
});
