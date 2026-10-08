import { NextRequest, NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { transitionHttp, transitionReservation } from "@/lib/reservation-lifecycle";
import { verifyGuestBookingByTokenOrCredentials } from "@/lib/guest-auth";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const {
      id,
      token,
      phone,
      booking_code,
      start_time: newStart,
      end_time: newEnd,
      guest_count: newGuestCount,
    } = body as {
      id: string;
      token?: string;
      phone?: string;
      booking_code?: string;
      start_time: string;
      end_time: string;
      guest_count?: number | null;
    };

    if (!id || !newStart || !newEnd || (!token?.trim() && (!phone?.trim() || !booking_code?.trim()))) {
      return NextResponse.json(
        { error: "缺少必填欄位（id、新時段，以及 token 或電話與訂位代號）" },
        { status: 400 }
      );
    }

    const limited = await enforceGuestLookupLimit(request, phone ?? "");
    if (limited) return limited;

    const verified = await verifyGuestBookingByTokenOrCredentials({
      id,
      token,
      phone,
      bookingCode: booking_code,
    });
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const result = await transitionReservation(
      verified.reservation.id,
      { type: "reschedule", start: newStart, end: newEnd, guestCount: newGuestCount },
      { kind: "guest" }
    );
    if (!result.ok) {
      const { status, body } = transitionHttp(result);
      return NextResponse.json(body, { status });
    }
    if (result.already) return NextResponse.json({ ok: true, already: true });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法改期";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
