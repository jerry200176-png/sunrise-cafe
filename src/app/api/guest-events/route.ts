import { NextRequest, NextResponse } from "next/server";
import { verifyGuestBooking } from "@/lib/guest-auth";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { logOps, type OpsLogAction } from "@/lib/ops-log";

const GUEST_EVENT_ACTIONS: Record<string, OpsLogAction> = {
  deposit_instructions_viewed: "guest.deposit_instructions_viewed",
  payment_line_pay_click: "guest.payment_line_pay_click",
  payment_line_official_click: "guest.payment_line_official_click",
};

/** Minimal guest funnel telemetry — auth via phone + booking_code, logs to ops JSON. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      event?: string;
      phone?: string;
      booking_code?: string;
    };
    const event = body.event?.trim() ?? "";
    const phone = body.phone?.trim() ?? "";
    const bookingCode = body.booking_code?.trim() ?? "";
    const action = GUEST_EVENT_ACTIONS[event];

    if (!action || !phone || !bookingCode) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

    const verified = await verifyGuestBooking(phone, bookingCode);
    if (!verified.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    logOps("guest", action, {
      reservation_id: verified.reservation.id,
      status: verified.reservation.status,
      deposit_paid: !!verified.reservation.is_deposit_paid,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
