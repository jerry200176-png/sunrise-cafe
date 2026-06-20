import { NextRequest, NextResponse } from "next/server";
import {
  updateReservationAdmin,
  fetchReservationsByPhone,
  hasSlotConflict,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineMessage as sendLineMessageToGroup } from "@/lib/line-notify";
import { notifyWaitlist } from "@/lib/waitlist";
import { toTaipei } from "@/lib/datetime";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function fmt(startTime: string, endTime: string) {
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  return `${formattedDate} ${timeRange}`;
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
      id,
      phone,
      start_time: newStart,
      end_time: newEnd,
      guest_count: newGuestCount,
    } = body as {
      id: string;
      phone: string;
      start_time: string;
      end_time: string;
      guest_count?: number | null;
    };

    const phoneNorm = phone?.trim();
    if (!phoneNorm || !id || !newStart || !newEnd) {
      return NextResponse.json(
        { error: "缺少必填欄位（id、電話、新時段）" },
        { status: 400 }
      );
    }

    const byPhone = await fetchReservationsByPhone(phoneNorm);
    const match = byPhone.find((r) => r.id === id);
    if (!match) {
      return NextResponse.json({ error: "找不到符合的訂位或電話不正確" }, { status: 404 });
    }
    if (match.status === "cancelled") {
      return NextResponse.json({ error: "此訂位已取消" }, { status: 400 });
    }

    const originalStartMs = new Date(match.start_time).getTime();
    if (originalStartMs - Date.now() < TWENTY_FOUR_HOURS_MS) {
      return NextResponse.json(
        { error: "預約時間 24 小時內不可自行改期，請來電店家" },
        { status: 400 }
      );
    }

    const newStartMs = new Date(newStart).getTime();
    const newEndMs = new Date(newEnd).getTime();
    const durationHours = (newEndMs - newStartMs) / (60 * 60 * 1000);
    if (durationHours <= 0) {
      return NextResponse.json({ error: "結束時間必須晚於開始時間" }, { status: 400 });
    }
    if (durationHours < 2 || durationHours > 8) {
      return NextResponse.json({ error: "預約時長須為 2～8 小時" }, { status: 400 });
    }
    if (newStartMs - Date.now() < TWENTY_FOUR_HOURS_MS) {
      return NextResponse.json(
        { error: "新時段須在 24 小時後，請選擇更晚的時間" },
        { status: 400 }
      );
    }

    const conflict = await hasSlotConflict(match.room_id, newStart, newEnd, id);
    if (conflict) {
      return NextResponse.json({ error: "該時段已被預訂，請重新選擇" }, { status: 409 });
    }

    const oldStart = match.start_time;
    const oldEnd = match.end_time;

    await updateReservationAdmin(id, {
      start_time: newStart,
      end_time: newEnd,
      guest_count: newGuestCount ?? match.guest_count,
      is_notified: false,
    });

    try {
      await sendLineMessageToGroup(
        `📅 客人自行改期\n` +
          `姓名：${match.customer_name}\n` +
          `電話：${match.phone}\n` +
          `代號：${match.booking_code}\n` +
          `原時段：${fmt(oldStart, oldEnd)}\n` +
          `新時段：${fmt(newStart, newEnd)}`
      );
    } catch (err) {
      console.error("[reschedule-booking] 群組通知失敗:", err);
    }

    notifyWaitlist(match.room_id, oldStart, oldEnd).catch((err) =>
      console.error("[reschedule-booking] waitlist notify failed:", err)
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法改期";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
