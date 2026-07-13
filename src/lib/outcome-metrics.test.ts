import { describe, expect, it } from "vitest";
import {
  buildHealthBlock,
  calcConversionRate,
  calcDepositRate,
  hoursSince,
} from "@/lib/outcome-metrics";

describe("calcDepositRate", () => {
  it("returns null when no eligible", () => {
    expect(calcDepositRate(0, 0)).toBeNull();
  });

  it("rounds to one decimal", () => {
    expect(calcDepositRate(17, 20)).toBe(85);
    expect(calcDepositRate(1, 3)).toBe(33.3);
  });
});

describe("calcConversionRate", () => {
  it("returns null when empty", () => {
    expect(calcConversionRate(0, 0)).toBeNull();
  });

  it("computes percentage", () => {
    expect(calcConversionRate(3, 10)).toBe(30);
  });
});

describe("hoursSince", () => {
  it("computes hours from ISO timestamp", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    const past = "2026-07-11T08:00:00Z";
    expect(hoursSince(past, now)).toBe(4);
  });
});

describe("buildHealthBlock", () => {
  it("maps snapshot fields to outcome block", () => {
    const block = buildHealthBlock({
      collected_at: "2026-07-11T10:00:00.000Z",
      status: "ok",
      booking: {
        bookings_30d: 10,
        bookings_7d: 2,
        cancellation_rate_30d: 0.1,
        cancellation_count_30d: 1,
      },
      payment: {
        deposit_rate_pct: 82.5,
        deposit_paid_30d: 8,
        deposit_eligible_30d: 10,
        pending_reviews: 1,
        payment_review_oldest_hours: 2.5,
        payment_review_median_hours_7d: 2,
        payment_review_sla_compliance_pct_7d: 90,
        payment_events_ready: true,
        deposit_at_risk: 3,
      },
      cancellation: { cancelled_30d: 1, auto_release_proxy_7d: 0 },
      refund: { tracked: false, note: "n/a", rejected_payments_7d: 0 },
      waitlist: { joined_30d: 5, converted_30d: 2, conversion_pct: 40 },
      cron: {
        scheduled_jobs: [],
        deposit_reminders_7d: 1,
        tomorrow_reminders_pending: 0,
        auto_releases_7d: 0,
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
        applied: ["20260710-reservations-no-overlap"],
        pending: ["20260710-phase7-rbac"],
        all_required_applied: false,
        overlap_constraint_active: true,
        closed_dates_column: true,
        rbac_tables: false,
      },
      support: { pending_payment_reviews: 1, rejected_events_7d: 0, note: "proxy" },
      funnel: {
        ops_events_ready: true,
        booking_flow_entered_7d: 20,
        booking_created_7d: 16,
        booking_conversion_pct: 80,
        deposit_instructions_viewed_7d: 10,
        payment_clicks_7d: 8,
        payment_completion_pct: 80,
        payment_approved_7d: 4,
        payment_approved_keyboard_7d: 2,
        keyboard_adoption_pct: 50,
      },
    });

    expect(block.date).toBe("2026-07-11");
    expect(block.deposit_rate_pct).toBe(82.5);
    expect(block.waitlist_conversion_pct).toBe(40);
    expect(block.migrations_all_applied).toBe("no");
    expect(block.overlap_constraint_active).toBe("yes");
    expect(block.reviewer).toBe("automated");
  });
});
