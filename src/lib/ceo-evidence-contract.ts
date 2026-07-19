/**
 * Shared CEO evidence contract builder (Sunrise) — PII-free.
 * Distinguishes unauthorized / unavailable / stale / zero_activity / ok.
 */
export type OutcomeAccess =
  | "ok"
  | "unauthorized"
  | "unavailable"
  | "stale"
  | "zero_activity";

export type CeoEvidenceContract = {
  project: string;
  as_of: string;
  production: {
    status: "green" | "amber" | "red" | "unknown";
    sha: string | null;
    verified: boolean;
  };
  critical_jobs: {
    expected: number;
    executed: number | null;
    succeeded: number | null;
    partial: number | null;
    failed: number | null;
    stale: number | null;
  };
  outcomes: Record<string, number | string | boolean | null>;
  outcome_access: OutcomeAccess;
  outcome_freshness_hours: number | null;
  risks: string[];
  founder_decisions_required: string[];
  evidence_confidence: "high" | "medium" | "low";
  github_portfolio?: Record<string, number | string>;
  product_quality?: Record<string, unknown>;
  open_source_intelligence?: Record<string, unknown>;
};

export function emptyOutcomesWithDenominators(): Record<string, number | null> {
  return {
    booking_started: null,
    booking_completed: null,
    booking_completion_rate: null,
    booking_completion_numerator: null,
    booking_completion_denominator: null,
    deposit_required: null,
    deposit_completed: null,
    deposit_completion_rate: null,
    deposit_completion_numerator: null,
    deposit_completion_denominator: null,
    reminder_runs_expected: 1,
    reminder_runs_executed: null,
    reminder_runs_accepted: null,
    reminder_failure_count: null,
    zero_booking_days: null,
    outcome_data_freshness: null,
    evidence_based_decisions: 0,
  };
}

/** Never treat access failure as zero activity. */
export function resolveOutcomeAccess(input: {
  authorized: boolean;
  collected: boolean;
  freshness_hours: number | null;
  booking_started: number | null;
  stale_after_hours?: number;
}): OutcomeAccess {
  if (!input.authorized) return "unauthorized";
  if (!input.collected) return "unavailable";
  const staleAfter = input.stale_after_hours ?? 36;
  if (input.freshness_hours != null && input.freshness_hours > staleAfter) return "stale";
  if (input.booking_started === 0) return "zero_activity";
  if (input.booking_started == null) return "unavailable";
  return "ok";
}

export function rateWithDenominator(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

export function confidenceForAccess(access: OutcomeAccess, hasLiveCounts: boolean): "high" | "medium" | "low" {
  if (access === "ok" && hasLiveCounts) return "high";
  if (access === "zero_activity") return "high"; // intentional empty day is trustworthy
  if (access === "stale") return "medium";
  if (access === "unauthorized" || access === "unavailable") return "low";
  return "low";
}

export function buildCeoEvidence(input: {
  sha: string | null;
  verified: boolean;
  health_ok: boolean;
  authorized?: boolean;
  collected?: boolean;
  outcomes?: Record<string, number | string | boolean | null>;
  reminder?: {
    executed?: number;
    accepted?: number;
    failed?: number;
    freshness_hours?: number | null;
  };
  risks?: string[];
}): CeoEvidenceContract {
  const risks = [...(input.risks ?? [])];
  if (!input.health_ok) risks.push("booking_health_not_ok");
  if (!input.verified) risks.push("production_not_verified");
  if (input.reminder?.freshness_hours != null && input.reminder.freshness_hours > 36) {
    risks.push("reminder_evidence_stale");
  }
  const outcomes = { ...emptyOutcomesWithDenominators(), ...(input.outcomes ?? {}) };
  const freshnessRaw = outcomes.outcome_data_freshness;
  let freshnessHours: number | null = null;
  if (typeof freshnessRaw === "string" && freshnessRaw) {
    freshnessHours = (Date.now() - new Date(freshnessRaw).getTime()) / (1000 * 60 * 60);
  }
  const bookingStarted =
    typeof outcomes.booking_started === "number" ? outcomes.booking_started : null;

  const outcome_access = resolveOutcomeAccess({
    authorized: input.authorized !== false,
    collected: input.collected === true,
    freshness_hours: freshnessHours,
    booking_started: bookingStarted,
  });

  if (outcome_access === "unauthorized") risks.push("outcome_access_unauthorized");
  if (outcome_access === "unavailable") risks.push("outcome_metrics_unavailable");
  if (outcome_access === "stale") risks.push("outcome_pipeline_stale");
  // zero_activity is NOT a risk / failure — do not push fake zero KPIs as errors

  let status: CeoEvidenceContract["production"]["status"] = "green";
  if (risks.some((r) => r.includes("stale") || r.includes("not_ok") || r.includes("unauthorized"))) {
    status = "red";
  } else if (risks.length) {
    status = "amber";
  }
  if (!input.sha) status = "unknown";

  const hasLive =
    typeof outcomes.booking_started === "number" &&
    typeof outcomes.deposit_required === "number";

  return {
    project: "sunrise-cafe",
    as_of: new Date().toISOString(),
    production: {
      status,
      sha: input.sha,
      verified: input.verified,
    },
    critical_jobs: {
      expected: 1,
      executed: input.reminder?.executed ?? null,
      succeeded: input.reminder?.accepted ?? null,
      partial: null,
      failed: input.reminder?.failed ?? null,
      stale: input.reminder?.freshness_hours != null && input.reminder.freshness_hours > 36 ? 1 : 0,
    },
    outcomes,
    outcome_access,
    outcome_freshness_hours: freshnessHours,
    risks,
    founder_decisions_required: [],
    evidence_confidence: confidenceForAccess(outcome_access, hasLive),
  };
}
