import { NextRequest, NextResponse } from "next/server";
import { fetchReservationsByPhone, isAdminConfigured } from "@/lib/supabase-admin";
import { fetchRoom, fetchBranch } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone?.trim()) {
    return NextResponse.json({ error: "請提供電話號碼" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const rows = await fetchReservationsByPhone(phone.trim());
    const now = new Date().toISOString();
    const active = rows.filter(
      (r) =>
        r.status !== "completed" &&
        r.status !== "cancelled" &&
        r.end_time >= now
    );
    const withNames = await Promise.all(
      active.map(async (r) => {
        const room = await fetchRoom(r.room_id);
        const branch = room?.branch_id ? await fetchBranch(room.branch_id) : null;
        return {
          id: r.id,
          booking_code: r.booking_code,
          room_name: room?.name ?? "—",
          branch_name: branch?.name ?? "—",
          start_time: r.start_time,
          end_time: r.end_time,
          status: r.status,
          total_price: r.total_price,
          guest_count: r.guest_count,
          customer_name: r.customer_name,
        };
      })
    );
    withNames.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return NextResponse.json(withNames);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法查詢";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
