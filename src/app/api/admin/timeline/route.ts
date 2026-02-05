import { NextRequest, NextResponse } from "next/server";
import {
  fetchReservationsAdmin,
  fetchRooms,
  fetchBranch,
  isAdminConfigured,
} from "@/lib/supabase-admin";

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

  try {
    const [reservations, rooms, branch] = await Promise.all([
      fetchReservationsAdmin(branchId),
      fetchRooms(branchId),
      fetchBranch(branchId),
    ]);
    const list = (reservations as { room_id: string; start_time: string; end_time: string; customer_name: string; status: string; total_price: number | null }[]) ?? [];
    const roomList = await Promise.all(
      (rooms as { id: string; name: string }[]).map(async (rm) => {
        const dayReservations = list.filter(
          (r) =>
            r.room_id === rm.id &&
            r.start_time < dayEnd &&
            r.end_time > dayStart
        );
        return {
          roomId: rm.id,
          roomName: rm.name,
          reservations: dayReservations.map((r) => ({
            start_time: r.start_time,
            end_time: r.end_time,
            customer_name: r.customer_name,
            status: r.status,
            total_price: r.total_price,
          })),
        };
      })
    );
    return NextResponse.json({
      date,
      branchName: branch?.name ?? "",
      openTime: branch?.open_time ?? "09:00",
      closeTime: branch?.close_time ?? "21:00",
      rooms: roomList,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入時間軸";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
