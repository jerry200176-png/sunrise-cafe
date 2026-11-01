import { NextRequest, type NextResponse } from "next/server";
import { rateLimit, getClientIp, guestRateLimitId } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-response";

/** Returns 429 for a quota rejection, 503 if the limiter is unavailable, or null. */
export async function enforceGuestLookupLimit(
  request: NextRequest,
  phone: string
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  return rateLimitResponse(await rateLimit(guestRateLimitId(ip, phone), "guestLookup"));
}
