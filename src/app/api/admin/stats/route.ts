import { NextRequest, NextResponse } from "next/server";
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
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;
  const now = new Date().toISOString();

  try {
    const [reservations, rooms] = await Promise.all([
      fetchReservationsAdmin(branchId),
      fetchRooms(branchId),
    ]);
    const list = (reservations as { start_time: string; end_time: string; status: string; total_price: number | null; room_id: string }[]) ?? [];

    const todayList = list.filter(
      (r) => r.status !== "cancelled" && r.start_time >= dayStart && r.start_time <= dayEnd
    );
    const todayCount = todayList.length;
    const todayRevenue = todayList.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0);
    const inUseNow = list.filter(
      (r) =>
        r.status !== "cancelled" &&
        r.status !== "completed" &&
        r.start_time <= now &&
        r.end_time > now
    );
    const roomsInUseCount = new Set(inUseNow.map((r) => r.room_id)).size;

    return NextResponse.json({
      date,
      todayCount,
      todayRevenue: Math.round(todayRevenue),
      roomsInUseCount,
      totalRooms: Array.isArray(rooms) ? rooms.length : 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入統計";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
