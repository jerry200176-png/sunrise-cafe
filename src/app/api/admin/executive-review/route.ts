import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";
import { buildNorthStarSnapshot } from "@/lib/north-star-metrics";
import { buildExecutiveReview } from "@/lib/executive-review";

/** Weekly Executive Review JSON + markdown (bi:read). */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const weekEnding = request.nextUrl.searchParams.get("week") ?? undefined;
  const outcome = await collectOutcomeMetrics();
  const northStar = buildNorthStarSnapshot(outcome);
  const review = buildExecutiveReview(northStar, weekEnding);

  return NextResponse.json(review, { headers: { "Cache-Control": "no-store" } });
}
