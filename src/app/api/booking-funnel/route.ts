import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit, guestRateLimitId } from "@/lib/rate-limit";
import { logOps, type OpsLogAction } from "@/lib/ops-log";

const ALLOWED_EVENTS = new Set([
  "booking_flow_entered",
  "booking_step_branch",
  "booking_step_date",
  "booking_step_room",
  "booking_step_slot",
  "booking_step_form",
  "booking_submit_success",
  "booking_submit_error",
]);

function toOps(event: string): { action: OpsLogAction; step?: string } {
  if (event === "booking_flow_entered") {
    return { action: "guest.booking_flow_entered" };
  }
  if (event === "booking_submit_success") {
    return { action: "guest.booking_submit_success" };
  }
  if (event === "booking_submit_error") {
    return { action: "guest.booking_submit_error" };
  }
  return { action: "guest.booking_step", step: event.replace("booking_step_", "") };
}

/** Public booking funnel (rate-limited, no PII). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { event?: string; ms?: number };
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

    const mapped = toOps(event);
    logOps("guest", mapped.action, {
      path: "/book",
      event,
      step: mapped.step,
      ms: typeof body.ms === "number" ? body.ms : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
