import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";

/** Admin UI + RBAC-gated live outcome metrics (bi:read). */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const snapshot = await collectOutcomeMetrics();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
