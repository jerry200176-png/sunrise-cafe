import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { buildBookingIcs, taipeiRangeLabel } from "@/lib/booking-ics";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { normalizePhone, phonesMatch } from "@/lib/phone-utils";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/guest/calendar.ics?code=ABC123&phone=09xxxxxxxx
 * Add-to-calendar without SMS; requires booking code + phone (same as guest lookup).
 */
export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }
  const { success } = await rateLimit(getClientIp(request), "guestLookup");
  if (!success) return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });

  const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  if (!code || code.length < 4 || !phone) {
    return NextResponse.json({ error: "請提供訂位代號與電話" }, { status: 400 });
  }

  const { data, error } = await db()
    .from("reservations")
    .select(
      "booking_code, phone, customer_name, start_time, end_time, status, room:rooms(name, branch:branches(name, display_name))"
    )
    .eq("booking_code", code)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "找不到訂位" }, { status: 404 });
  }
  if (!phonesMatch(String(data.phone), normalizePhone(phone))) {
    return NextResponse.json({ error: "電話與訂位代號不符" }, { status: 403 });
  }
  if (data.status === "cancelled") {
    return NextResponse.json({ error: "此訂位已取消" }, { status: 410 });
  }

  const room = data.room as {
    name?: string;
    branch?: { name?: string; display_name?: string | null };
  } | null;
  const store =
    room?.branch?.display_name?.trim() ||
    (room?.branch?.name ? `昇昇咖啡 (${room.branch.name})` : "昇昇咖啡");
  const roomName = room?.name ?? "包廂";
  const range = taipeiRangeLabel(String(data.start_time), String(data.end_time));

  const ics = buildBookingIcs({
    bookingCode: String(data.booking_code),
    summary: `${store} · ${roomName}`,
    description: `訂位碼 ${data.booking_code} · ${data.customer_name} · ${range}`,
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
