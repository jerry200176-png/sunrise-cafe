import { NextRequest, NextResponse } from "next/server";
import {
  updateReservationAdmin,
  hasSlotConflict,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineFlex, buildRescheduleGroupFlex } from "@/lib/line-notify";
import { notifyWaitlist } from "@/lib/waitlist";
import { resetLineReminderDeliveries } from "@/lib/line-delivery";

import { verifyGuestBookingById } from "@/lib/guest-auth";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
      booking_code,
      start_time: newStart,
      end_time: newEnd,
      guest_count: newGuestCount,
    } = body as {
      id: string;
      phone: string;
      booking_code: string;
      start_time: string;
      end_time: string;
      guest_count?: number | null;
    };

    if (!phone?.trim() || !id || !booking_code?.trim() || !newStart || !newEnd) {
      return NextResponse.json(
        { error: "缺少必填欄位（id、電話、訂位代號、新時段）" },
        { status: 400 }
      );
    }

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

    const verified = await verifyGuestBookingById(phone, booking_code, id);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const match = verified.reservation;
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
      d1_guest_reminder_sent_at: null,
    });
    await resetLineReminderDeliveries(id);

    try {
      await sendLineFlex(
        `客人改期：${match.customer_name}`,
        buildRescheduleGroupFlex({
          customerName: match.customer_name,
          phone: match.phone,
          bookingCode: match.booking_code,
          oldStart,
          oldEnd,
          newStart,
          newEnd,
        })
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
