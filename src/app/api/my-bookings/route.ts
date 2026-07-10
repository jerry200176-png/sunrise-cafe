import { NextRequest, NextResponse } from "next/server";
import { fetchRoom, fetchBranch, isAdminConfigured } from "@/lib/supabase-admin";
import { isDepositRequired, getDepositAmount } from "@/lib/booking-utils";
import { verifyGuestBooking } from "@/lib/guest-auth";

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  const bookingCode = request.nextUrl.searchParams.get("booking_code");

  if (!phone?.trim() || !bookingCode?.trim()) {
    return NextResponse.json(
      { error: "請提供電話號碼與訂位代號" },
      { status: 400 }
    );
  }

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }

  try {
    const verified = await verifyGuestBooking(phone, bookingCode);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const r = verified.reservation;
    const now = new Date().toISOString();
    if (
      r.status === "completed" ||
      r.status === "cancelled" ||
      r.end_time < now
    ) {
      return NextResponse.json([]);
    }

    const room = await fetchRoom(r.room_id);
    const branch = room?.branch_id ? await fetchBranch(room.branch_id) : null;
    const dateStr = r.start_time.slice(0, 10);
    const depositRequired = isDepositRequired(dateStr);

    const item = {
      id: r.id,
      booking_code: r.booking_code,
      room_id: r.room_id,
      branch_id: room?.branch_id ?? null,
      room_name: room?.name ?? "—",
      branch_name: branch?.name ?? "—",
      branch_display_name: branch?.display_name ?? null,
      payment_info: branch?.payment_info ?? null,
      line_pay_url: branch?.line_pay_url ?? null,
      start_time: r.start_time,
      end_time: r.end_time,
      status: r.status,
      total_price: r.total_price,
      guest_count: r.guest_count,
      customer_name: r.customer_name,
      deposit_required: depositRequired,
      deposit_amount:
        depositRequired && r.total_price != null
          ? getDepositAmount(Number(r.total_price))
          : null,
      is_deposit_paid: r.is_deposit_paid,
    };

    return NextResponse.json([item]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法查詢";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
