import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { fetchAnalyticsSummary, isAnalyticsConfigured } from "@/lib/analytics-server";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAnalyticsConfigured()) {
    return NextResponse.json(
      { error: "Analytics not configured" },
      { status: 503 }
    );
  }

  const daysParam = request.nextUrl.searchParams.get("days");
  const days = Math.min(90, Math.max(1, Number(daysParam) || 7));

  try {
    const summary = await fetchAnalyticsSummary(days);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入分析";
    if (message.includes("analytics_events")) {
      return NextResponse.json(
        { error: "請先執行 migration-analytics-events.sql", migration_required: true },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
