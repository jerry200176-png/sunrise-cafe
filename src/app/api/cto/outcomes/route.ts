import { NextRequest, NextResponse } from "next/server";
import { isValidCtoBearer } from "@/lib/cto-auth";
import { collectOutcomeMetrics } from "@/lib/outcome-metrics";

/** Machine-readable outcome pipeline — CTO scripts / cron. Auth: Bearer CTO_OUTCOME_SECRET */
export async function GET(request: NextRequest) {
  if (!isValidCtoBearer(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await collectOutcomeMetrics();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
