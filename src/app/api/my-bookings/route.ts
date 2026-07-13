import { NextRequest, NextResponse } from "next/server";
import {
  lookupGuestBookings,
  lookupGuestBookingsByDate,
} from "@/lib/guest-booking-lookup";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";

/** POST preferred — credentials in body, not URL/logs (industry privacy practice). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      booking_code?: string;
      booking_date?: string;
    };
    const phone = body.phone?.trim() ?? "";
    const bookingCode = body.booking_code?.trim() ?? "";
    const bookingDate = body.booking_date?.trim() ?? "";

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

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

/** @deprecated Use POST — kept for backward compatibility. */
export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  const bookingCode = request.nextUrl.searchParams.get("booking_code")?.trim() ?? "";
  const bookingDate = request.nextUrl.searchParams.get("booking_date")?.trim() ?? "";

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
}
