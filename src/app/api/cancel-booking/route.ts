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
import { sendLineFlexMessage } from "@/lib/line";
import { buildGuestBookingCancelledFlex } from "@/lib/line-cards";
import { deliverLineGuestNotification } from "@/lib/line-guest-delivery";

type GuestCancellationRow = {
  line_user_id?: string | null;
  customer_name?: string | null;
  booking_code?: string | null;
  start_time: string;
  end_time: string;
  room?: { branch?: { name?: string } | { name?: string }[] | null } | { branch?: { name?: string } | { name?: string }[] | null }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

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

    const guest = match as GuestCancellationRow;
    if (guest.line_user_id) {
      const room = firstRelation(guest.room);
      const branch = firstRelation(room?.branch);
      try {
        await deliverLineGuestNotification({
          notificationType: "booking_cancelled",
          reservationId: match.id,
          recipientId: guest.line_user_id,
          send: () =>
            sendLineFlexMessage(
              guest.line_user_id!,
              "訂位已取消",
              buildGuestBookingCancelledFlex({
                customerName: guest.customer_name ?? "您好",
                branchName: branch?.name ?? "昇咖啡",
                bookingCode: guest.booking_code,
                startTime: guest.start_time,
                endTime: guest.end_time,
              })
            ),
        });
      } catch (err) {
        console.error("[cancel-booking] guest LINE notify failed:", err);
      }
    }

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
