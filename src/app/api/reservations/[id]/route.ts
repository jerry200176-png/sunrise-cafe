import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, deleteReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineFlexMessage, buildPaymentFlex } from "@/lib/line";
import { type BranchPaymentConfig } from "@/lib/payment-message";
import { notifyWaitlist } from "@/lib/waitlist";
import { createClient } from "@supabase/supabase-js";
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type RoomWithBranch = { name: string; branch: { id: string; name: string }[] }[];

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

    // 後台取消時，通知等位清單
    if (patch.status === "cancelled") {
      const { data: cancelled } = await supabaseAdmin()
        .from("reservations")
        .select("room_id, start_time, end_time")
        .eq("id", id)
        .single();
      if (cancelled) {
        notifyWaitlist(cancelled.room_id, cancelled.start_time, cancelled.end_time).catch(
          (err) => console.error("[reservations/id] waitlist notify failed:", err)
        );
      }
    }

    // 確認訂位 or 填金額時，只要兩個條件都齊就自動傳 LINE 繳費通知
    const triggerLine = patch.status === "confirmed" || patch.total_price !== undefined;
    let lineResult: string | null = null;
    if (triggerLine) {
      try {
        const { data: r } = await supabaseAdmin()
          .from("reservations")
          .select(`
            line_user_id,
            customer_name,
            start_time,
            end_time,
            total_price,
            room_with_branch:rooms(name, price_weekday, price_weekend, branch:branches(id, name))
          `)
          .eq("id", id)
          .single();

        if (!r?.line_user_id) {
          lineResult = "no_line_id";
        } else {
          const roomInfo = (r.room_with_branch as RoomWithBranch | null)?.[0];
          const branchRef = (roomInfo?.branch ?? [])[0];

          // 若無金額，從房間定價自動計算
          let total = r.total_price != null ? Number(r.total_price) : null;
          if (total == null && roomInfo) {
            const start = new Date(r.start_time);
            const isWeekend = [0, 6].includes(start.getDay());
            const pricePerHour = isWeekend
              ? Number((roomInfo as Record<string, unknown>).price_weekend ?? 0)
              : Number((roomInfo as Record<string, unknown>).price_weekday ?? 0);
            const hours = (new Date(r.end_time).getTime() - start.getTime()) / 3_600_000;
            total = Math.round(pricePerHour * hours);
            await supabaseAdmin().from("reservations").update({ total_price: total }).eq("id", id);
          }

          if (total == null || total === 0) {
            lineResult = "no_price";
          } else {
            // 以 select=* 取分店付款設定（容錯：欄位未建立時降級為通用話術）
            let branch: BranchPaymentConfig = { name: branchRef?.name ?? null };
            if (branchRef?.id) {
              const { data: b } = await supabaseAdmin()
                .from("branches")
                .select("*")
                .eq("id", branchRef.id)
                .single();
              if (b) branch = b as BranchPaymentConfig;
            }
            const flex = buildPaymentFlex({
              customerName: r.customer_name,
              startTime: r.start_time,
              endTime: r.end_time,
              total,
              branch,
            });
            await sendLineFlexMessage(r.line_user_id, "訂金繳費通知", flex);
            lineResult = "sent";
          }
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
