import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { canAccessBranch } from "@/lib/rbac";
import { getReservationForPreorder, getReservationPreorder, requirePreorderReconfirmation } from "@/lib/reservation-preorder";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function authorized(request: NextRequest, id: string, permission: string) {
  const denied = await requirePermission(request, permission);
  if (denied) return { response: denied };
  const reservation = await getReservationForPreorder(id);
  const room = Array.isArray(reservation?.room) ? reservation?.room[0] : reservation?.room;
  const ctx = await getAdminContext(request);
  if (!reservation || !canAccessBranch(ctx, room?.branch_id)) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { reservation, ctx };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const auth = await authorized(request, id, "reservations:read");
    if (auth.response) return auth.response;
    return NextResponse.json({ reservation: auth.reservation, preorder: await getReservationPreorder(id) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "無法載入預製餐點" }, { status: 500 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const auth = await authorized(request, id, "reservations:write");
    if (auth.response) return auth.response;
    const body = await request.json() as { action?: string; reason?: string };
    if (body.action !== "reconfirm" || !body.reason?.trim()) return NextResponse.json({ error: "需要 reconfirm action 與 reason" }, { status: 400 });
    await requirePreorderReconfirmation(id, `staff_override:${body.reason.trim()}`, auth.ctx!.user_id ?? auth.ctx!.role);
    const { error } = await supabaseAdmin().from("ops_events").insert({ domain: "admin", action: "preorder.staff_override", detail: { reservation_id: id, reason: body.reason.trim(), actor: auth.ctx!.user_id ?? auth.ctx!.role } });
    if (error) throw error;
    return NextResponse.json({ ok: true, preorder: await getReservationPreorder(id) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "無法套用預製餐點 override" }, { status: 500 }); }
}
