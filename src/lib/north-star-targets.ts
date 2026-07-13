/**
 * North Star target definitions with documented rationale (not arbitrary).
 */
import type { NorthStarMetricId } from "./north-star-metrics";

export type NorthStarTargetDef = {
  target: number;
  direction: "up" | "down";
  unit: string;
  rationale: string;
};

export const NORTH_STAR_TARGETS: Record<NorthStarMetricId, NorthStarTargetDef> = {
  booking_conversion: {
    target: 65,
    direction: "up",
    unit: "%",
    rationale:
      "Multi-step booking forms typically convert 55–70% (Baymard/form analytics benchmarks). 65% is midpoint for a 5-step flow with deposit requirement.",
  },
  deposit_conversion: {
    target: 85,
    direction: "up",
    unit: "%",
    rationale:
      "OUTCOME_LOG weekly review target; weekend/holiday deposit policy requires ≥85% paid to avoid slot waste and auto-release churn.",
  },
  waitlist_conversion: {
    target: 30,
    direction: "up",
    unit: "%",
    rationale:
      "OUTCOME_LOG weekly review target; notified waitlist guests have LINE binding — 30% is achievable with 30-min confirm window.",
  },
  avg_booking_time: {
    target: 5,
    direction: "down",
    unit: "min",
    rationale:
      "Guest UX research: >5 min on mobile increases abandonment; aligns with booking_conversion target.",
  },
  payment_completion_rate: {
    target: 70,
    direction: "up",
    unit: "%",
    rationale:
      "Users who view deposit instructions are high-intent; 70% CTA click is conservative vs e-commerce add-to-cart→checkout (~65–80%).",
  },
  admin_payment_review_sla: {
    target: 90,
    direction: "up",
    unit: "%",
    rationale:
      "≥90% of payment reviews completed within 4h keeps weekend deposit holds reliable; oldest-pending hours tracked separately for alerts.",
  },
  admin_keyboard_adoption: {
    target: 30,
    direction: "up",
    unit: "%",
    rationale:
      "Power-user adoption threshold for keyboard shortcuts; 30% at T+14 indicates feature worth keeping (below 10% → simplify or remove).",
  },
  customer_support_proxy: {
    target: 5,
    direction: "down",
    unit: "count",
    rationale:
      "Small-team ops: pending_reviews + deposit_at_risk >5 implies staff overload and guest wait time; derived from daily review capacity (~5 items/shift).",
  },
  production_error_rate: {
    target: 1,
    direction: "down",
    unit: "%",
    rationale:
      "SRE standard: <1% cron failure rate keeps deposit reminders and auto-release reliable.",
  },
  cancellation_rate: {
    target: 15,
    direction: "down",
    unit: "%",
    rationale:
      "Hospitality booking benchmark: >15% cancellation indicates friction (deposit confusion, slot conflicts); aligns with deposit_conversion goal.",
  },
  core_web_vitals_lcp: {
    target: 2.5,
    direction: "down",
    unit: "s",
    rationale: "Google Core Web Vitals 'good' threshold (p75 LCP < 2.5s) — mobile booking is primary channel.",
  },
  api_latency_p95: {
    target: 500,
    direction: "down",
    unit: "ms",
    rationale:
      "Admin morning dashboard: p95 <500ms keeps staff flow under 1s perceived wait (Nielsen response-time guideline).",
  },
};
