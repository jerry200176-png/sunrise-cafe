import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, deleteReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineMessage, buildPaymentMessage } from "@/lib/line";
import { createClient } from "@supabase/supabase-js";
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type RoomWithBranch = { name: string; branch: { name: string }[] }[];

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
    if (body.is_deposit_paid !== undefined) patch.is_deposit_paid = Boolean(body.is_deposit_paid);
    if (body.deposit_payment_note !== undefined)
      patch.deposit_payment_note = body.deposit_payment_note == null || body.deposit_payment_note === "" ? null : String(body.deposit_payment_note);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "未提供可更新欄位" }, { status: 400 });
    }
    await updateReservationAdmin(id, patch);

    // 若狀態改為 confirmed，嘗試自動傳 LINE 繳費通知
    let lineResult: string | null = null;
    if (patch.status === "confirmed") {
      try {
        const { data: r } = await supabaseAdmin()
          .from("reservations")
          .select(`
            line_user_id,
            customer_name,
            start_time,
            end_time,
            total_price,
            room_with_branch:rooms(name, branch:branches(name))
          `)
          .eq("id", id)
          .single();

        if (!r?.line_user_id) {
          lineResult = "no_line_id";
        } else if (r.total_price == null) {
          lineResult = "no_price";
        } else {
          const roomInfo = (r.room_with_branch as RoomWithBranch | null)?.[0];
          const branchName = (roomInfo?.branch ?? [])[0]?.name ?? "";
          const text = buildPaymentMessage({
            customerName: r.customer_name,
            startTime: r.start_time,
            endTime: r.end_time,
            total: Number(r.total_price),
            branchName,
          });
          await sendLineMessage(r.line_user_id, text);
          lineResult = "sent";
        }
      } catch (err) {
        lineResult = `error: ${err instanceof Error ? err.message : String(err)}`;
        console.error("[confirm] LINE 推播失敗:", err);
      }
    }

    return NextResponse.json({ ok: true, lineResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
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
    await deleteReservationAdmin(id);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法刪除訂位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
