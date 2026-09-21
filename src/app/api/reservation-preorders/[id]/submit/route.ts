import { NextRequest, NextResponse } from "next/server";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { verifyGuestBookingByTokenOrCredentials } from "@/lib/guest-auth";
import { isReservationPreorderEnabled, submitPreorder, type DraftItemInput } from "@/lib/reservation-preorder";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isReservationPreorderEnabled()) return NextResponse.json({ error: "提前選餐尚未開放" }, { status: 404 });
  const id = (await params).id;
  try {
    const body = await request.json() as { token?: string; phone?: string; booking_code?: string; items?: DraftItemInput[]; guest_notes?: string | null; idempotency_key?: string };
    const limited = await enforceGuestLookupLimit(request, body.phone ?? "");
    if (limited) return limited;
    const verified = await verifyGuestBookingByTokenOrCredentials({ id, token: body.token, phone: body.phone, bookingCode: body.booking_code });
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
    const key = body.idempotency_key?.trim() || request.headers.get("Idempotency-Key")?.trim() || "";
    const data = await submitPreorder(id, body.items ?? [], body.guest_notes ?? null, key);
    return NextResponse.json({ ok: true, preorder: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法送出提前選餐";
    const status = /截止|取消|完成|無法|idempotency|reservation is/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
