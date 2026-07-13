import { NextRequest, NextResponse } from "next/server";
import { isWeekendDate } from "@/lib/booking-utils";
import { SlotConflictError } from "@/lib/slot-conflict";
import { createClient } from "@supabase/supabase-js";
import { hasSlotConflict, insertReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineFlex, buildWaitlistBookedGroupFlex } from "@/lib/line-notify";
import { WAITLIST_CONFIRM_WINDOW_MINUTES } from "@/lib/waitlist";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function fetchEntryByToken(token: string) {
  const { data, error } = await supabaseAdmin()
    .from("waitlist")
    .select(
      "id, room_id, customer_name, phone, start_time, end_time, status, notified_at, room:rooms(name, price_weekday, price_weekend, branch:branches(name))"
    )
    .eq("confirm_token", token)
    .single();
  if (error || !data) return null;
  return data;
}

function isExpired(notifiedAt: string | null): boolean {
  if (!notifiedAt) return false;
  const deadline = new Date(notifiedAt).getTime() + WAITLIST_CONFIRM_WINDOW_MINUTES * 60 * 1000;
  return Date.now() > deadline;
}

// GET: 確認頁載入用，回傳候補詳情供客人確認
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "缺少 token" }, { status: 400 });
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const entry = await fetchEntryByToken(token);
  if (!entry) return NextResponse.json({ error: "找不到此候補紀錄" }, { status: 404 });

  const room = Array.isArray(entry.room) ? entry.room[0] : entry.room;
  const branch = Array.isArray(room?.branch) ? room.branch[0] : room?.branch;
  const expired = entry.status === "notified" && isExpired(entry.notified_at);

  return NextResponse.json({
    status: expired ? "expired" : entry.status,
    customer_name: entry.customer_name,
    start_time: entry.start_time,
    end_time: entry.end_time,
    room_name: room?.name ?? "",
    branch_name: branch?.name ?? "",
  });
}

// POST: 客人點擊一鍵確認，將候補轉為正式訂位
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  try {
    const { token } = (await request.json()) as { token?: string };
    if (!token) return NextResponse.json({ error: "缺少 token" }, { status: 400 });

    const entry = await fetchEntryByToken(token);
    if (!entry) return NextResponse.json({ error: "找不到此候補紀錄" }, { status: 404 });

    if (entry.status === "booked") {
      return NextResponse.json({ error: "此候補已完成訂位，請勿重複確認" }, { status: 409 });
    }
    if (entry.status !== "notified") {
      return NextResponse.json({ error: "此候補尚未進入可確認狀態" }, { status: 400 });
    }
    if (isExpired(entry.notified_at)) {
      await supabaseAdmin().from("waitlist").update({ status: "expired" }).eq("id", entry.id);
      return NextResponse.json(
        { error: "確認連結已逾時，此時段已釋出給下一位候補，請重新加入候補或致電店家" },
        { status: 410 }
      );
    }

    const conflict = await hasSlotConflict(entry.room_id, entry.start_time, entry.end_time);
    if (conflict) {
      await supabaseAdmin().from("waitlist").update({ status: "expired" }).eq("id", entry.id);
      return NextResponse.json(
        { error: "很抱歉，此時段已被其他訂位佔用，請重新加入候補" },
        { status: 409 }
      );
    }

    const room = Array.isArray(entry.room) ? entry.room[0] : entry.room;
    const branch = Array.isArray(room?.branch) ? room.branch[0] : room?.branch;

    let totalPrice: number | null = null;
    if (room) {
      const dateStr = entry.start_time.slice(0, 10);
      const pricePerHour = Number(
        isWeekendDate(dateStr) ? room.price_weekend : room.price_weekday
      ) || 0;
      const hours = (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 3_600_000;
      totalPrice = Math.round(pricePerHour * hours);
    }

    // 嘗試從舊訂位複製已綁定的 LINE
    let lineUserId: string | null = null;
    try {
      const { data: bound } = await supabaseAdmin()
        .from("reservations")
        .select("line_user_id")
        .eq("phone", entry.phone)
        .not("line_user_id", "is", null)
        .limit(1)
        .single();
      lineUserId = bound?.line_user_id ?? null;
    } catch { /* 查無舊綁定，略過 */ }

    const { id, booking_code } = await insertReservationAdmin({
      room_id: entry.room_id,
      customer_name: entry.customer_name,
      phone: entry.phone,
      email: null,
      start_time: entry.start_time,
      end_time: entry.end_time,
      status: "pending",
      total_price: totalPrice,
      guest_count: null,
      notes: "候補一鍵確認轉訂位",
      line_user_id: lineUserId,
    });

    await supabaseAdmin().from("waitlist").update({ status: "booked" }).eq("id", entry.id);

    try {
      await sendLineFlex(
        `候補轉訂位：${entry.customer_name}`,
        buildWaitlistBookedGroupFlex({
          customerName: entry.customer_name,
          phone: entry.phone,
          bookingCode: booking_code,
          roomLabel: `${branch?.name ?? ""} — ${room?.name ?? ""}`,
          startTime: entry.start_time,
          endTime: entry.end_time,
        })
      );
    } catch (err) {
      console.error("[waitlist/confirm] 群組通知失敗:", err);
    }

    return NextResponse.json({ ok: true, id, booking_code });
  } catch (err) {
    if (err instanceof SlotConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "確認失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
