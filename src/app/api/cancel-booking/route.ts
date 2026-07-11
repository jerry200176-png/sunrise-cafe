import { NextRequest, NextResponse } from "next/server";
import {
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { notifyWaitlist } from "@/lib/waitlist";
import { verifyGuestBookingById } from "@/lib/guest-auth";

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
    const { id, booking_code, phone } = body as {
      id: string;
      booking_code: string;
      phone: string;
    };

    if (!id || !booking_code?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: "請提供訂位 id、電話與訂位代號" },
        { status: 400 }
      );
    }

    const verified = await verifyGuestBookingById(phone, booking_code, id);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const match = verified.reservation;
    const start = new Date(match.start_time).getTime();
    const now = Date.now();
    if (start - now < TWENTY_FOUR_HOURS_MS) {
      return NextResponse.json(
        { error: "預約時間 24 小時內不可自行取消，請來電店家" },
        { status: 400 }
      );
    }
    if (match.status === "cancelled") {
      return NextResponse.json({ error: "此訂位已取消" }, { status: 400 });
    }
    if (match.is_deposit_paid) {
      return NextResponse.json(
        { error: "已付訂金的訂位請來電店家協助取消" },
        { status: 400 }
      );
    }

    await updateReservationAdmin(match.id, { status: "cancelled" });

    notifyWaitlist(match.room_id, match.start_time, match.end_time).catch((err) =>
      console.error("[cancel-booking] waitlist notify failed:", err)
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取消";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
