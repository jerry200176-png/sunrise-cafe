import { NextRequest, NextResponse } from "next/server";
import { lookupGuestBookings } from "@/lib/guest-booking-lookup";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";

async function handleLookup(phone: string, bookingCode: string) {
  const result = await lookupGuestBookings(phone, bookingCode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.items);
}

/** POST preferred — credentials in body, not URL/logs (industry privacy practice). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { phone?: string; booking_code?: string };
    const phone = body.phone?.trim() ?? "";
    const bookingCode = body.booking_code?.trim() ?? "";

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

    return handleLookup(phone, bookingCode);
  } catch {
    return NextResponse.json({ error: "無效的請求" }, { status: 400 });
  }
}

/** @deprecated Use POST — kept for backward compatibility. */
export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  const bookingCode = request.nextUrl.searchParams.get("booking_code")?.trim() ?? "";
  return handleLookup(phone, bookingCode);
}
