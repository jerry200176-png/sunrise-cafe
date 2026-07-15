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

  const contracts = northStar.metrics.map((m) => {
    const evaluation = evaluateContractCompleteness({
      id: m.id,
      observed: m.observed,
      table_ready:
        m.id.startsWith("admin_payment") || m.id === "deposit_conversion"
          ? outcome.payment.payment_events_ready
          : m.id === "production_error_rate"
            ? outcome.cron.job_runs_ready
            : m.id === "booking_conversion" || m.id === "payment_completion_rate"
              ? outcome.funnel.ops_events_ready
              : undefined,
    });
    return {
      ...NORTH_STAR_CONTRACTS[m.id],
      evaluation,
    };
  });

  const contract_satisfied_count = contracts.filter((c) => c.evaluation.contract_satisfied).length;

  return NextResponse.json(
    {
      ...northStar,
      outcome_status: outcome.status,
      contracts,
      contract_satisfied_count,
      contract_total: contracts.length,
      a_grade_note:
        "A-grade requires contract_satisfied for gating metrics with production truth reconciliation — not merely observed != null",
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
