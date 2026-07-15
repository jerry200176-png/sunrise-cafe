import { NextRequest, NextResponse } from "next/server";
import {
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { notifyWaitlist } from "@/lib/waitlist";
import { verifyGuestBookingById } from "@/lib/guest-auth";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { evaluateGuestCancel } from "@/lib/cancel-refund-policy";
import { logOps } from "@/lib/ops-log";

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const { id, booking_code, phone } = body as {
      id: string;
      booking_code: string;
      phone: string;
    };

    if (!id || !booking_code?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: "請提供訂位 id、電話與訂位代號" },
        { status: 400 }
      );
    }

    const limited = await enforceGuestLookupLimit(request, phone);
    if (limited) return limited;

    const verified = await verifyGuestBookingById(phone, booking_code, id);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const match = verified.reservation;
    if (match.status === "cancelled") {
      return NextResponse.json({ error: "此訂位已取消" }, { status: 400 });
    }

    const decision = evaluateGuestCancel({
      isDepositPaid: Boolean(match.is_deposit_paid),
      startTimeMs: new Date(match.start_time).getTime(),
    });

    if (!decision.allowed) {
      logOps("guest", "guest.cancel_blocked", {
        eligibility: decision.eligibility,
        reservation_id: match.id,
      });
      return NextResponse.json(
        {
          error: decision.message ?? "目前無法自行取消",
          eligibility: decision.eligibility,
          refund_request_available: decision.eligibility === "staff_review_required",
        },
        { status: 400 }
      );
    }

    await updateReservationAdmin(match.id, { status: "cancelled" });

    notifyWaitlist(match.room_id, match.start_time, match.end_time).catch((err) =>
      console.error("[cancel-booking] waitlist notify failed:", err)
    );

    logOps("guest", "guest.cancel_ok", { reservation_id: match.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取消";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
