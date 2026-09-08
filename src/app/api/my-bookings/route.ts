import { NextRequest, NextResponse } from "next/server";
import {
  lookupGuestBookings,
  lookupGuestBookingsByDate,
  lookupGuestBookingByToken,
} from "@/lib/guest-booking-lookup";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";

/** POST preferred — credentials in body, not URL/logs (industry privacy practice). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      token?: string;
      phone?: string;
      booking_code?: string;
      booking_date?: string;
    };
    const token = body.token?.trim() ?? "";
    const phone = body.phone?.trim() ?? "";
    const bookingCode = body.booking_code?.trim() ?? "";
    const bookingDate = body.booking_date?.trim() ?? "";

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

    // Prefer token when provided (safe 1-click lookup with zero PII in URLs)
    if (token) {
      const result = await lookupGuestBookingByToken(token);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.items);
    }

    // Prefer booking_code when both provided
    if (bookingCode) {
      const result = await lookupGuestBookings(phone, bookingCode);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.items);
    }

    if (bookingDate) {
      const result = await lookupGuestBookingsByDate(phone, bookingDate);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.items);
    }

    return NextResponse.json(
      { error: "請提供訂位代號，或使用電話與訂位日期找回" },
      { status: 400 }
    );
  } catch {
    return NextResponse.json({ error: "無效的請求" }, { status: 400 });
  }
}

/**
 * GET /api/my-bookings?token=<signed_token> (preferred, zero PII in URL)
 * Legacy GET with ?phone= is permanently retired (HTTP 410 Sunset).
 * Use POST /api/my-bookings for phone / booking_code / date lookup in body.
 */
export async function GET(request: NextRequest) {
  // Explicit Sunset: Reject any phone number in URL query string
  if (request.nextUrl.searchParams.has("phone")) {
    return NextResponse.json(
      {
        error: "為保護個人隱私，GET 查詢已終止支援網址電話號碼參數。請改用 POST 請求（電話放置於 request body）或使用安全 token 查詢。",
        sunset: true,
        code: "PHONE_URL_PARAM_RETIRED",
      },
      { status: 410 }
    );
  }

  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (token) {
    const limited = await enforceGuestLookupLimit(request, "");
    if (limited) return limited;
    const result = await lookupGuestBookingByToken(token);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.items);
  }

  return NextResponse.json(
    { error: "請使用安全的訂位查詢 token，或改以 POST 傳送查詢資料" },
    { status: 400 }
  );
}
