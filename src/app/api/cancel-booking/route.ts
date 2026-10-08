import { NextRequest, NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { verifyGuestBookingByTokenOrCredentials } from "@/lib/guest-auth";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { logOps } from "@/lib/ops-log";
import { transitionHttp, transitionReservation } from "@/lib/reservation-lifecycle";

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const { id, token, booking_code, phone } = body as {
      id: string;
      token?: string;
      booking_code?: string;
      phone?: string;
    };

    if (!id || (!token?.trim() && (!booking_code?.trim() || !phone?.trim()))) {
      return NextResponse.json(
        { error: "請提供訂位驗證資訊（token 或電話與訂位代號）" },
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

    const result = await transitionReservation(verified.reservation.id, { type: "cancel" }, { kind: "guest" });
    if (!result.ok) {
      const { status, body } = transitionHttp(result);
      return NextResponse.json(body, { status });
    }

    logOps("guest", "guest.cancel_ok", { reservation_id: verified.reservation.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取消";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
