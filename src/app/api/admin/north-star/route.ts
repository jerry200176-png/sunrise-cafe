import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";
import { buildNorthStarSnapshot } from "@/lib/north-star-metrics";

/** North Star KPIs for product improvement loop (bi:read). */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const outcome = await collectOutcomeMetrics();
  const northStar = buildNorthStarSnapshot(outcome);

  return NextResponse.json(
    {
      ...northStar,
      outcome_status: outcome.status,
      improvement_loop: "Hypothesis → Baseline → Implement → Measure → Compare → Iterate",
      executive_review: "/api/admin/executive-review",
      docs: {
        loop: "/docs/PRODUCT_IMPROVEMENT_LOOP.md",
        metrics: "/docs/NORTH_STAR_METRICS.md",
        hypotheses: "/docs/HYPOTHESES.md",
        weekly_review: "/docs/WEEKLY_EXECUTIVE_REVIEW.md",
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
