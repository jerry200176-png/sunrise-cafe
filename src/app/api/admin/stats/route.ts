import { NextRequest, NextResponse } from "next/server";
import {
  buildDashboardStats,
  dashboardWindows,
  isDashboardDate,
  type DashboardReservation,
  type DashboardRoom,
} from "@/lib/admin-dashboard-data";
import { fetchReservationsOverlapping } from "@/lib/reservation-list-query";
import { fetchRooms, isAdminConfigured } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/admin-api-auth";
import { taipeiDateString } from "@/lib/datetime";

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const dateParam = request.nextUrl.searchParams.get("date");
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
  const date = dateParam || taipeiDateString();

  if (!isDashboardDate(date)) {
    return NextResponse.json({ error: "日期格式不正確（YYYY-MM-DD）" }, { status: 400 });
  }

  try {
    const [reservations, rooms] = await Promise.all([
      fetchReservationsOverlapping(branchId, dashboardWindows("stats", date)),
      fetchRooms(branchId),
    ]);
    const list = (Array.isArray(reservations) ? reservations : []) as DashboardReservation[];
    const roomList = (Array.isArray(rooms) ? rooms : []) as DashboardRoom[];

    return NextResponse.json(buildDashboardStats(date, list, roomList));
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入統計";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
