/**
 * Shared CEO evidence contract builder (Sunrise) — PII-free.
 */
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
  risks: string[];
  founder_decisions_required: string[];
  evidence_confidence: "high" | "medium" | "low";
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

export function buildCeoEvidence(input: {
  sha: string | null;
  verified: boolean;
  health_ok: boolean;
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
  let status: CeoEvidenceContract["production"]["status"] = "green";
  if (risks.length) status = risks.some((r) => r.includes("stale") || r.includes("not_ok")) ? "red" : "amber";
  if (!input.sha) status = "unknown";

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
    risks,
    founder_decisions_required: [],
    evidence_confidence: outcomes.booking_started != null ? "medium" : "low",
  };
}
