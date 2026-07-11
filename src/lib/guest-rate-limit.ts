import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp, guestRateLimitId } from "@/lib/rate-limit";

/** Returns 429 response or null if allowed. */
export async function enforceGuestLookupLimit(
  request: NextRequest,
  phone: string
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const { success, reset } = await rateLimit(guestRateLimitId(ip, phone), "guestLookup");
  if (success) return null;
  return NextResponse.json(
    { error: "Too Many Requests" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) },
    }
  );
}
