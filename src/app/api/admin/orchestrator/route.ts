import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { collectOrchestratorSnapshot } from "@/lib/orchestrator-snapshot";

/** Engineering task wall — ranked autonomous work queue (ops:read). */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "ops:read");
  if (denied) return denied;

  const snapshot = collectOrchestratorSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
