import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";
import { buildNorthStarSnapshot } from "@/lib/north-star-metrics";
import {
  evaluateContractCompleteness,
  NORTH_STAR_CONTRACTS,
} from "@/lib/north-star-contracts";

/** North Star KPIs for product improvement loop (bi:read). */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const outcome = await collectOutcomeMetrics();
  const northStar = buildNorthStarSnapshot(outcome);

  const funnelReady = outcome.funnel.ops_events_ready;
  const contracts = northStar.metrics.map((m) => {
    const table_ready =
      m.id.startsWith("admin_payment") ||
      m.id === "deposit_conversion" ||
      m.id === "customer_support_proxy"
        ? outcome.payment.payment_events_ready
        : m.id === "production_error_rate"
          ? outcome.cron.job_runs_ready
          : m.id === "booking_conversion" ||
              m.id === "payment_completion_rate" ||
              m.id === "avg_booking_time" ||
              m.id === "admin_keyboard_adoption"
            ? funnelReady
            : m.id === "waitlist_conversion" || m.id === "cancellation_rate"
              ? true
              : undefined;

    const cronRuns = outcome.cron.jobs.reduce((acc, j) => acc + (j.runs_7d ?? 0), 0);

    const denominator_n =
      m.id === "booking_conversion"
        ? outcome.funnel.booking_flow_entered_7d ?? null
        : m.id === "payment_completion_rate"
          ? outcome.funnel.deposit_instructions_viewed_7d ?? null
          : m.id === "admin_keyboard_adoption"
            ? outcome.funnel.payment_approved_7d ?? null
            : m.id === "production_error_rate"
              ? cronRuns || null
              : m.id === "customer_support_proxy"
                ? 1
                : null;

    const evaluation = evaluateContractCompleteness({
      id: m.id,
      observed: m.observed,
      table_ready,
      denominator_n,
      source_fresh_at: funnelReady ? outcome.funnel.freshest_ts ?? null : null,
    });
    return {
      ...NORTH_STAR_CONTRACTS[m.id],
      evaluation,
    };
  });

  const contract_satisfied_count = contracts.filter((c) => c.evaluation.contract_satisfied).length;
  const alerts = contracts.flatMap((c) => c.evaluation.alerts);

  return NextResponse.json(
    {
      ...northStar,
      outcome_status: outcome.status,
      contracts,
      contract_satisfied_count,
      contract_total: contracts.length,
      data_quality_alerts: alerts,
      a_grade_note:
        "A-grade requires a_grade_eligible (completeness + freshness + reconciliation) — observed != null is never enough",
      improvement_loop: "Hypothesis → Baseline → Implement → Measure → Compare → Iterate",
      executive_review: "/api/admin/executive-review",
      docs: {
        contracts: "/docs/internal/executive/NORTH_STAR_METRICS.md",
        loop: "/docs/internal/automation/PRODUCT_IMPROVEMENT_LOOP.md",
        metrics: "/docs/internal/executive/NORTH_STAR_METRICS.md",
        hypotheses: "/docs/internal/automation/HYPOTHESES.md",
        weekly_review: "/docs/internal/executive/WEEKLY_EXECUTIVE_REVIEW.md",
        product: "/docs/PRODUCT.md",
        roadmap: "/docs/ROADMAP.md",
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
