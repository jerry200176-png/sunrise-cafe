import { NextResponse } from "next/server";
import { fetchReservationsForReminder, isAdminConfigured } from "@/lib/supabase-admin";
import { fetchRoom, fetchBranch } from "@/lib/supabase-admin";

/** GET: 回傳明日待提醒訂位列表（供排程或後台檢視） */
export async function GET() {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const rows = await fetchReservationsForReminder();
    const withNames = await Promise.all(
      rows.map(async (r) => {
        const room = await fetchRoom(r.room_id);
        const branch = room?.branch_id ? await fetchBranch(room.branch_id) : null;
        return {
          id: r.id,
          booking_code: r.booking_code,
          room_name: room?.name ?? "—",
          branch_name: branch?.name ?? "—",
          start_time: r.start_time,
          end_time: r.end_time,
          customer_name: r.customer_name,
          phone: r.phone,
          email: r.email,
        };
      })
    );
    return NextResponse.json(withNames);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入提醒列表";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
