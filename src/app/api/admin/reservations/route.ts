import { NextRequest, NextResponse } from "next/server";
import {
  fetchReservationsByPhone,
  fetchRoom,
  hasSlotConflict,
  insertReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { getAdminContext, requireAdminApiAuth } from "@/lib/admin-api-auth";
import { assertReservationWriteAllowed } from "@/lib/reservation-access";
import { isWeekendDate } from "@/lib/booking-utils";
import { reservationDateKey } from "@/lib/datetime";
import { sendDepositPaymentRequest } from "@/lib/payment-request-line";
import { SlotConflictError } from "@/lib/slot-conflict";

type RequestBody = {
  room_id?: string;
  customer_name?: string;
  phone?: string;
  email?: string | null;
  start_time?: string;
  end_time?: string;
  guest_count?: number | null;
  notes?: string | null;
};

export async function POST(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as RequestBody;
    const roomId = body.room_id?.trim();
    const customerName = body.customer_name?.trim();
    const phone = body.phone?.trim();
    const startTime = body.start_time;
    const endTime = body.end_time;

    if (!roomId || !customerName || !phone || !startTime || !endTime) {
      return NextResponse.json(
        { error: "缺少必填欄位（包廂、姓名、電話、開始與結束時間）" },
        { status: 400 }
      );
    }

    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const durationHours = (endMs - startMs) / 3_600_000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return NextResponse.json({ error: "開始與結束時間格式錯誤" }, { status: 400 });
    }
    if (durationHours <= 0) {
      return NextResponse.json({ error: "結束時間必須晚於開始時間" }, { status: 400 });
    }
    if (durationHours < 2 || durationHours > 8) {
      return NextResponse.json(
        { error: durationHours < 2 ? "包廂最少需預約 2 小時" : "單次預約時長不得超過 8 小時" },
        { status: 400 }
      );
    }

    const room = await fetchRoom(roomId);
    if (!room) return NextResponse.json({ error: "包廂不存在" }, { status: 404 });

    const ctx = await getAdminContext(request);
    const rbacDenied = assertReservationWriteAllowed(ctx, room.branch_id);
    if (rbacDenied) return NextResponse.json({ error: rbacDenied }, { status: 403 });

    if (await hasSlotConflict(roomId, startTime, endTime)) {
      return NextResponse.json({ error: "該時段已被預訂，請重新選擇" }, { status: 409 });
    }

    const previousReservations = await fetchReservationsByPhone(phone).catch(() => []);
    const lineUserId = (previousReservations as { line_user_id?: string | null }[]).find(
      (reservation) => reservation.line_user_id
    )?.line_user_id ?? null;
    const pricePerHour = isWeekendDate(reservationDateKey(startTime))
      ? Number(room.price_weekend)
      : Number(room.price_weekday);
    const totalPrice = Math.round(pricePerHour * durationHours);
    const { id, booking_code } = await insertReservationAdmin({
      room_id: roomId,
      customer_name: customerName,
      phone,
      email: body.email?.trim() || null,
      start_time: startTime,
      end_time: endTime,
      status: "confirmed",
      total_price: totalPrice,
      guest_count: body.guest_count ?? null,
      notes: body.notes?.trim() || null,
      line_user_id: lineUserId,
    });

    let lineResult: string | null = null;
    try {
      const payment = await sendDepositPaymentRequest(id, {
        force: false,
        actorUserId: ctx.user_id,
      });
      lineResult = payment.detail ? `${payment.result}: ${payment.detail}` : payment.result;
    } catch (error) {
      console.error("[admin/reservations] LINE 訂金通知失敗:", error);
      lineResult = "error";
    }

    return NextResponse.json({ ok: true, id, booking_code, lineResult });
  } catch (error) {
    if (error instanceof SlotConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "無法新增訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
