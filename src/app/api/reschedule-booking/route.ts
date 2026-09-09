import { NextRequest, NextResponse } from "next/server";
import {
  updateReservationAdmin,
  hasSlotConflict,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineFlex, buildRescheduleGroupFlex } from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import { buildGuestBookingRescheduledFlex } from "@/lib/line-cards";
import { deliverLineGuestNotification } from "@/lib/line-guest-delivery";
import { notifyWaitlist } from "@/lib/waitlist";
import { resetLineReminderDeliveries } from "@/lib/line-delivery";
import { stableLineRetryKey } from "@/lib/line-retry-key";

import { verifyGuestBookingByTokenOrCredentials } from "@/lib/guest-auth";
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
      token,
      phone,
      booking_code,
      start_time: newStart,
      end_time: newEnd,
      guest_count: newGuestCount,
    } = body as {
      id: string;
      token?: string;
      phone?: string;
      booking_code?: string;
      start_time: string;
      end_time: string;
      guest_count?: number | null;
    };

    if (!id || !newStart || !newEnd || (!token?.trim() && (!phone?.trim() || !booking_code?.trim()))) {
      return NextResponse.json(
        { error: "缺少必填欄位（id、新時段，以及 token 或電話與訂位代號）" },
        { status: 400 }
      );
    }

    const limited = await enforceGuestLookupLimit(request, phone ?? "");
    if (limited) return limited;

    const verified = await verifyGuestBookingByTokenOrCredentials({
      id,
      token,
      phone,
      bookingCode: booking_code,
    });
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

    const requestedGuestCount = newGuestCount ?? match.guest_count;
    const sameSchedule =
      new Date(newStart).getTime() === new Date(match.start_time).getTime() &&
      new Date(newEnd).getTime() === new Date(match.end_time).getTime() &&
      requestedGuestCount === match.guest_count;
    if (sameSchedule) {
      return NextResponse.json({ ok: true, already: true });
    }

    const oldStart = match.start_time;
    const oldEnd = match.end_time;

    await updateReservationAdmin(id, {
      start_time: newStart,
      end_time: newEnd,
      guest_count: requestedGuestCount,
      is_notified: false,
      d1_guest_reminder_sent_at: null,
    });
    await resetLineReminderDeliveries(id);

    if (match.line_user_id) {
      const roomRaw = match.room as { branch?: { name?: string } | { name?: string }[] | null } | { branch?: { name?: string } | { name?: string }[] | null }[] | null;
      const room = Array.isArray(roomRaw) ? roomRaw[0] : roomRaw;
      const branchRaw = room?.branch;
      const branch = Array.isArray(branchRaw) ? branchRaw[0] : branchRaw;
      try {
        await deliverLineGuestNotification({
          notificationType: "booking_rescheduled",
          reservationId: id,
          recipientId: String(match.line_user_id),
          eventKey: `${newStart}|${newEnd}`,
          send: () =>
            sendLineFlexMessage(
              String(match.line_user_id),
              "訂位已改期",
              buildGuestBookingRescheduledFlex({
                customerName: match.customer_name,
                branchName: branch?.name ?? "昇咖啡",
                bookingCode: match.booking_code,
                oldStart,
                oldEnd,
                newStart,
                newEnd,
              })
            ),
        });
      } catch (err) {
        console.error("[reschedule-booking] guest LINE notify failed:", err);
      }
    }

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
        }),
        {
          retryKey: stableLineRetryKey(
            "booking-rescheduled-group",
            id,
            newStart,
            newEnd,
            String(requestedGuestCount ?? "")
          ),
        }
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
