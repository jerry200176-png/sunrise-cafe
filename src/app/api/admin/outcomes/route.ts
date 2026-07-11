import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";

/** Admin UI + authenticated access to live outcome metrics. */
export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  const snapshot = await collectOutcomeMetrics();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
