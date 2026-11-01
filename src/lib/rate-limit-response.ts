import { NextResponse } from "next/server";
import type { RateLimitResult } from "@/lib/rate-limit";

/** Returns null only when the limiter made an affirmative decision. */
export function rateLimitResponse(result: RateLimitResult): NextResponse | null {
  if (result.success && !result.unavailable) return null;
  const retry = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: result.unavailable ? "Service Temporarily Unavailable" : "Too Many Requests" },
    { status: result.unavailable ? 503 : 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" } },
  );
}
