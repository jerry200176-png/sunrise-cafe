import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { buildBookingIcs, taipeiRangeLabel } from "@/lib/booking-ics";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { normalizePhone, phonesMatch } from "@/lib/phone-utils";
import { verifyLookupToken } from "@/lib/lookup-token";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type ReservationWithRoom = {
  booking_code: string | number;
  phone?: string | number | null;
  customer_name: string;
  start_time: string;
  end_time: string;
  status: string;
  room: unknown;
};

function makeIcsResponse(data: ReservationWithRoom) {
  const room = data.room as {
    name?: string;
    branch?: { name?: string; display_name?: string | null };
  } | null;
  const store =
    room?.branch?.display_name?.trim() ||
    (room?.branch?.name ? `昇昇咖啡 (${room.branch.name})` : "昇昇咖啡");
  const roomName = room?.name ?? "包廂";
  const range = taipeiRangeLabel(String(data.start_time), String(data.end_time));
  const code = String(data.booking_code);

  const ics = buildBookingIcs({
    bookingCode: code,
    summary: `${store} · ${roomName}`,
    description: `訂位碼 ${code} · ${data.customer_name} · ${range}`,
    location: store,
    startTime: String(data.start_time),
    endTime: String(data.end_time),
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="sunrise-${code}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * GET /api/guest/calendar.ics?token=<signed_token> (preferred, zero PII in URL)
 * GET /api/guest/calendar.ics?code=ABC123&phone=09xxxxxxxx (legacy, protected against enumeration)
 */
export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }
  const { success } = await rateLimit(getClientIp(request), "guestLookup");
  if (!success) return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });

  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (token) {
    const verified = verifyLookupToken(token);
    if (!verified.ok) {
      return NextResponse.json({ error: "連結無效或已過期" }, { status: 400 });
    }

    const { data, error } = await db()
      .from("reservations")
      .select(
        "booking_code, phone, customer_name, start_time, end_time, status, room:rooms(name, branch:branches(name, display_name))"
      )
      .eq("id", verified.reservationId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "找不到訂位" }, { status: 404 });
    }
    if (data.status === "cancelled") {
      return NextResponse.json({ error: "此訂位已取消" }, { status: 410 });
    }

    return makeIcsResponse(data as ReservationWithRoom);
  }

  const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  if (!code || code.length < 4 || !phone) {
    return NextResponse.json({ error: "請提供訂位代號與電話，或使用查詢 token" }, { status: 400 });
  }

  const { data, error } = await db()
    .from("reservations")
    .select(
      "booking_code, phone, customer_name, start_time, end_time, status, room:rooms(name, branch:branches(name, display_name))"
    )
    .eq("booking_code", code)
    .maybeSingle();

  // Unified 404 response eliminates enumeration oracle (does not leak whether code exists or phone mismatched)
  if (error || !data || !phonesMatch(String(data.phone), normalizePhone(phone))) {
    return NextResponse.json({ error: "找不到符合的訂位，請確認電話與訂位代號" }, { status: 404 });
  }
  if (data.status === "cancelled") {
    return NextResponse.json({ error: "此訂位已取消" }, { status: 410 });
  }

  return makeIcsResponse(data as ReservationWithRoom);
}
