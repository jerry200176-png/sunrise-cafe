import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const patch: Parameters<typeof updateReservationAdmin>[1] = {};
    if (body.customer_name !== undefined) patch.customer_name = String(body.customer_name).trim();
    if (body.phone !== undefined) patch.phone = String(body.phone).trim();
    if (body.email !== undefined) patch.email = body.email == null || body.email === "" ? null : String(body.email).trim();
    if (body.start_time !== undefined) patch.start_time = body.start_time;
    if (body.end_time !== undefined) patch.end_time = body.end_time;
    if (body.status !== undefined) patch.status = body.status;
    if (body.total_price !== undefined) patch.total_price = body.total_price == null ? null : Number(body.total_price);
    if (body.guest_count !== undefined) patch.guest_count = body.guest_count == null ? null : Number(body.guest_count);
    if (body.notes !== undefined) patch.notes = body.notes == null || body.notes === "" ? null : String(body.notes).trim();
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "未提供可更新欄位" }, { status: 400 });
    }
    await updateReservationAdmin(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
