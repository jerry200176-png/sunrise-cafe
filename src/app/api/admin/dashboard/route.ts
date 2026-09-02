import { NextRequest, NextResponse } from "next/server";
import { fetchDashboardBundle } from "@/lib/admin-dashboard-data";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/admin-api-auth";
import { taipeiDateString } from "@/lib/datetime";

/** Single round-trip dashboard bundle: stats + timeline + 7d trend (ADM-005b). */
export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const date =
    request.nextUrl.searchParams.get("date") ??
    taipeiDateString();

  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  const denied = await requirePermission(request, "reservations:read", branchId);
  if (denied) return denied;
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }

  try {
    const bundle = await fetchDashboardBundle(branchId, date);
    return NextResponse.json(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入儀表板";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
