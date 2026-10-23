import { NextRequest, NextResponse } from "next/server";
import {
  buildDashboardTrend,
  dashboardWindows,
  isDashboardDate,
  type DashboardReservation,
} from "@/lib/admin-dashboard-data";
import { fetchReservationsOverlapping } from "@/lib/reservation-list-query";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/admin-api-auth";
import { taipeiDateString } from "@/lib/datetime";

/** 7-day booking trend in one DB round-trip (ADM-005). */
export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const endDate =
    request.nextUrl.searchParams.get("endDate") ??
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

  if (!isDashboardDate(endDate)) {
    return NextResponse.json({ error: "日期格式不正確（YYYY-MM-DD）" }, { status: 400 });
  }

  try {
    const reservations = await fetchReservationsOverlapping(branchId, dashboardWindows("trend", endDate));
    const list = (Array.isArray(reservations) ? reservations : []) as DashboardReservation[];

    return NextResponse.json(buildDashboardTrend(endDate, list));
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入趨勢";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
