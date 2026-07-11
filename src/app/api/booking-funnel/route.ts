import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit, guestRateLimitId } from "@/lib/rate-limit";
import { logOps } from "@/lib/ops-log";

const ALLOWED_EVENTS = new Set(["booking_flow_entered"]);

/** Public booking funnel entry (rate-limited, no PII). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { event?: string };
    const event = body.event?.trim() ?? "";
    if (!ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    const ip = getClientIp(request);
    const { success, reset } = await rateLimit(guestRateLimitId(ip, "funnel"), "guestLookup");
    if (!success) {
      return NextResponse.json(
        { error: "Too Many Requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } }
      );
    }

    logOps("guest", "guest.booking_flow_entered", { path: "/book" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
