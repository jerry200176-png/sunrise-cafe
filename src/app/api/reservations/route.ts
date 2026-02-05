import { NextRequest, NextResponse } from "next/server";
import {
  fetchReservationsAdmin,
  insertReservationAdmin,
  hasSlotConflict,
  isAdminConfigured,
} from "@/lib/supabase-admin";

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
    };
    if (!roomId || !customerName?.trim() || !phone?.trim() || !startTime || !endTime) {
      return NextResponse.json(
        { error: "缺少必填欄位（包廂、姓名、電話、開始與結束時間）" },
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
      total_price: totalPrice ?? null,
      guest_count: guestCount ?? null,
      notes: notes?.trim() || null,
    });
    return NextResponse.json({ ok: true, id, booking_code });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法新增訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
