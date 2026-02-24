import { NextResponse } from "next/server";
import { fetchTomorrowsReservations, isAdminConfigured } from "@/lib/supabase-admin";

/** GET: 回傳明日待提醒訂位列表（供排程或後台檢視） */
export async function GET() {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const rows = await fetchTomorrowsReservations();
    const formatted = rows.map((r: any) => ({
      id: r.id,
      booking_code: r.booking_code,
      room_name: r.room?.name ?? "—",
      branch_name: r.room?.branch?.name ?? "—",
      start_time: r.start_time,
      end_time: r.end_time,
      customer_name: r.customer_name,
      phone: r.phone,
      email: r.email,
      is_notified: r.is_notified, // 增加這個欄位供前端判斷（可選）
    }));
    return NextResponse.json(formatted);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入提醒列表";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
