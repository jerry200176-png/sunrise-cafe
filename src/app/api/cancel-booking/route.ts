import { NextRequest, NextResponse } from "next/server";
import {
  updateReservationAdmin,
  fetchReservationsByPhone,
  isAdminConfigured,
} from "@/lib/supabase-admin";

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
      id?: string;
      booking_code?: string;
      phone: string;
    };
    const phoneNorm = phone?.trim();
    if (!phoneNorm) {
      return NextResponse.json({ error: "請提供電話號碼" }, { status: 400 });
    }
    if (!id && !booking_code) {
      return NextResponse.json({ error: "請提供訂位 id 或 booking_code" }, { status: 400 });
    }
    const byPhone = await fetchReservationsByPhone(phoneNorm);
    const match = id
      ? byPhone.find((r) => r.id === id)
      : byPhone.find((r) => r.booking_code === String(booking_code).trim());
    if (!match) {
      return NextResponse.json({ error: "找不到符合的訂位或電話不正確" }, { status: 404 });
    }
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
    await updateReservationAdmin(match.id, { status: "cancelled" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取消";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
