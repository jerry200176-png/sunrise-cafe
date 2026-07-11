import { describe, expect, it } from "vitest";
import { buildNorthStarSnapshot, calcCronFailureRate } from "./north-star-metrics";
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
      jobs: [{ job_name: "test", last_status: "ok", runs_7d: 100, failed_7d: 0, last_items_processed: 1 }],
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
    ...overrides,
  };
}

describe("calcCronFailureRate", () => {
  it("returns null when no runs", () => {
    expect(calcCronFailureRate([])).toBeNull();
  });

  it("computes failure percentage", () => {
    expect(
      calcCronFailureRate([
        { job_name: "a", last_status: "ok", runs_7d: 50, failed_7d: 1, last_items_processed: 0 },
        { job_name: "b", last_status: "ok", runs_7d: 50, failed_7d: 0, last_items_processed: 0 },
      ])
    ).toBe(1);
  });
});

describe("buildNorthStarSnapshot", () => {
  it("maps deposit and waitlist conversion from outcome snapshot", () => {
    const ns = buildNorthStarSnapshot(minimalSnapshot());
    const deposit = ns.metrics.find((m) => m.id === "deposit_conversion");
    const waitlist = ns.metrics.find((m) => m.id === "waitlist_conversion");
    expect(deposit?.value).toBe(80);
    expect(waitlist?.value).toBe(30);
    expect(waitlist?.status).toBe("on_track");
  });

  it("marks funnel metrics unmeasured until log aggregation exists", () => {
    const ns = buildNorthStarSnapshot(minimalSnapshot());
    expect(ns.metrics.find((m) => m.id === "booking_conversion")?.status).toBe("unmeasured");
    expect(ns.unmeasured_count).toBeGreaterThan(0);
  });
});
