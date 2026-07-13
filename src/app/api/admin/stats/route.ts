import { NextRequest, NextResponse } from "next/server";
import {
  buildDashboardStats,
  type DashboardReservation,
  type DashboardRoom,
} from "@/lib/admin-dashboard-data";
import { fetchReservationsAdmin, fetchRooms, isAdminConfigured } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  const date = dateParam || new Date().toISOString().slice(0, 10);

  try {
    const [reservations, rooms] = await Promise.all([
      fetchReservationsAdmin(branchId),
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
