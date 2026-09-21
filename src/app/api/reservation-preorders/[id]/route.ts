import { NextRequest, NextResponse } from "next/server";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { verifyGuestBookingByTokenOrCredentials } from "@/lib/guest-auth";
import {
  getPreorderCatalog,
  getReservationPreorder,
  isPreorderCutoffPassed,
  isReservationPreorderEnabled,
} from "@/lib/reservation-preorder";

async function verify(request: NextRequest, id: string, body?: Record<string, unknown>) {
  const token = typeof body?.token === "string" ? body.token : request.nextUrl.searchParams.get("token");
  const phone = typeof body?.phone === "string" ? body.phone : request.nextUrl.searchParams.get("phone");
  const code = typeof body?.booking_code === "string" ? body.booking_code : request.nextUrl.searchParams.get("booking_code");
  const limited = await enforceGuestLookupLimit(request, phone ?? "");
  if (limited) return { response: limited };
  const verified = await verifyGuestBookingByTokenOrCredentials({ id, token, phone, bookingCode: code });
  if (!verified.ok) return { response: NextResponse.json({ error: verified.error }, { status: verified.status }) };
  return { reservation: verified.reservation };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isReservationPreorderEnabled()) return NextResponse.json({ error: "提前選餐尚未開放" }, { status: 404 });
  const id = (await params).id;
  const auth = await verify(request, id);
  if (auth.response) return auth.response;
  try {
    const [preorder, catalog] = await Promise.all([getReservationPreorder(id), getPreorderCatalog(id)]);
    const cutoffPassed = isPreorderCutoffPassed(auth.reservation!.start_time);
    return NextResponse.json({
      reservation: {
        id, booking_code: auth.reservation!.booking_code, customer_name: auth.reservation!.customer_name,
        start_time: auth.reservation!.start_time, end_time: auth.reservation!.end_time,
        guest_count: auth.reservation!.guest_count, room: auth.reservation!.room,
      },
      preorder: preorder ? { ...preorder, status: cutoffPassed && preorder.status === "submitted" ? "locked" : preorder.status } : null,
      menu: cutoffPassed ? [] : catalog.items,
      cutoff_at: new Date(new Date(auth.reservation!.start_time).getTime() - 24 * 60 * 60 * 1000).toISOString(),
      editable: !cutoffPassed && !["cancelled", "completed"].includes(auth.reservation!.status) && !["submitted", "locked"].includes(preorder?.status ?? ""),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法載入提前選餐" }, { status: 500 });
  }
}
