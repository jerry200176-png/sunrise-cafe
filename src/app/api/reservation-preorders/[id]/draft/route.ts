import { NextRequest, NextResponse } from "next/server";
import { enforceGuestLookupLimit } from "@/lib/guest-rate-limit";
import { verifyGuestBookingByTokenOrCredentials } from "@/lib/guest-auth";
import { getReservationPreorder, isReservationPreorderEnabled, savePreorderDraft, type DraftItemInput } from "@/lib/reservation-preorder";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isReservationPreorderEnabled()) return NextResponse.json({ error: "提前選餐尚未開放" }, { status: 404 });
  const id = (await params).id;
  try {
    const body = await request.json() as { token?: string; phone?: string; booking_code?: string; items?: DraftItemInput[]; guest_notes?: string | null };
    const limited = await enforceGuestLookupLimit(request, body.phone ?? "");
    if (limited) return limited;
    const verified = await verifyGuestBookingByTokenOrCredentials({ id, token: body.token, phone: body.phone, bookingCode: body.booking_code });
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
    const current = await getReservationPreorder(id);
    if (current && ["submitted", "locked"].includes(current.status)) {
      return NextResponse.json({ error: "餐點已送出，若需調整請聯絡店家" }, { status: 409 });
    }
    const data = await savePreorderDraft(id, body.items ?? [], body.guest_notes ?? null);
    return NextResponse.json({ ok: true, preorder: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法儲存提前選餐";
    return NextResponse.json({ error: message }, { status: /截止|已送出|無法/.test(message) ? 409 : 400 });
  }
}
