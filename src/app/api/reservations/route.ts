import { NextRequest, NextResponse } from "next/server";
import {
  fetchReservationsAdmin,
  insertReservationAdmin,
  hasSlotConflict,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineMessage } from "@/lib/line-notify";
import { createClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const data = await fetchReservationsAdmin(branchId);
    return NextResponse.json(data ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const {
      room_id: roomId,
      customer_name: customerName,
      phone,
      email,
      start_time: startTime,
      end_time: endTime,
      total_price: totalPrice,
      guest_count: guestCount,
      notes,
      status,
    } = body as {
      room_id: string;
      customer_name: string;
      phone: string;
      email?: string | null;
      start_time: string;
      end_time: string;
      total_price?: number | null;
      guest_count?: number | null;
      notes?: string | null;
      status?: string;
    };

    if (!roomId || !customerName?.trim() || !phone?.trim() || !startTime || !endTime) {
      return NextResponse.json(
        { error: "缺少必填欄位（包廂、姓名、電話、開始與結束時間）" },
        { status: 400 }
      );
    }

    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const durationHours = (endMs - startMs) / (60 * 60 * 1000);

    if (durationHours <= 0) {
      return NextResponse.json(
        { error: "結束時間必須晚於開始時間" },
        { status: 400 }
      );
    }
    if (durationHours < 2) {
      return NextResponse.json(
        { error: "包廂最少需預約 2 小時" },
        { status: 400 }
      );
    }
    if (durationHours > 8) {
      return NextResponse.json(
        { error: "單次預約時長不得超過 8 小時" },
        { status: 400 }
      );
    }

    const conflict = await hasSlotConflict(roomId, startTime, endTime);
    if (conflict) {
      return NextResponse.json(
        { error: "該時段已被預訂，請重新選擇" },
        { status: 409 }
      );
    }

    const { id, booking_code } = await insertReservationAdmin({
      room_id: roomId,
      customer_name: customerName.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      start_time: startTime,
      end_time: endTime,
      status: status ?? "pending",
      total_price: totalPrice ?? null,
      guest_count: guestCount ?? null,
      notes: notes?.trim() || null,
    });

    // 若電話已有綁定的 line_user_id，複製到新訂位
    try {
      const { data: bound } = await supabaseAdmin()
        .from("reservations")
        .select("line_user_id")
        .eq("phone", phone.trim())
        .not("line_user_id", "is", null)
        .neq("id", id)
        .limit(1)
        .single();
      if (bound?.line_user_id) {
        await supabaseAdmin()
          .from("reservations")
          .update({ line_user_id: bound.line_user_id })
          .eq("id", id);
      }
    } catch { /* 查無舊綁定，略過 */ }

    // 傳群組通知（失敗不影響主流程）
    try {
      const startDate = parseISO(startTime);
      const endDate = parseISO(endTime);
      const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
      const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
      const guestStr = guestCount ? `${guestCount} 人` : "未填";
      const notesStr = notes?.trim() ? `\n備註：${notes.trim()}` : "";
      const groupText =
        `📩 新訂位申請\n` +
        `姓名：${customerName.trim()}\n` +
        `電話：${phone.trim()}\n` +
        `代號：${booking_code}\n` +
        `時間：${formattedDate} ${timeRange}\n` +
        `人數：${guestStr}` +
        notesStr;
      await sendLineMessage(groupText);
    } catch (err) {
      console.error("[reservations] 群組通知失敗:", err);
    }

    return NextResponse.json({ ok: true, id, booking_code });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法新增訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
