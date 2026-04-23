import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, deleteReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";
import { sendLineMessage } from "@/lib/line";
import { createClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type RoomWithBranch = { name: string; branch: { name: string }[] }[];

function buildPaymentText(r: {
  customer_name: string;
  start_time: string;
  end_time: string;
  total_price: number | null;
  room_with_branch?: RoomWithBranch | null;
}): string {
  const startDate = parseISO(r.start_time);
  const endDate = parseISO(r.end_time);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const total = Number(r.total_price ?? 0);
  const deposit = Math.ceil(total / 2);
  const roomInfo = (r.room_with_branch ?? [])[0];
  const branchName = (roomInfo?.branch ?? [])[0]?.name ?? "";
  const isDaan = branchName.includes("大安");
  const linePayUrl =
    "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";

  if (isDaan) {
    return (
      `您好，這裡是昇昇咖啡 (大安店)。\n\n` +
      `收到您 ${formattedDate} ${timeRange} 的預約申請（${r.customer_name}）。\n` +
      `確認該時段有空位，本筆訂單總金額為 $${total}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n` +
      `【匯款資訊】\n銀行：台北富邦銀行 (012)\n帳號：8212-00000-8489-6\n戶名：昇昇咖啡張文霞\n\n` +
      `或者您可以使用 LINE Pay 付款：\n${linePayUrl}\n\n` +
      `匯款後請回傳「末五碼」或「截圖」告知，謝謝！\n\n` +
      `📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`
    );
  }
  return (
    `您好，這裡是昇昇咖啡。\n\n` +
    `收到您 ${formattedDate} ${timeRange} 的預約申請（${r.customer_name}）。\n` +
    `確認該時段有空位，本筆訂單總金額為 $${total}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n` +
    `請依照官網或現場指示完成付款，並回傳證明，謝謝！\n\n` +
    `📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`
  );
}

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

        if (r?.line_user_id && r.total_price != null) {
          const text = buildPaymentText({
            customer_name: r.customer_name,
            start_time: r.start_time,
            end_time: r.end_time,
            total_price: r.total_price,
            room_with_branch: r.room_with_branch as RoomWithBranch | null,
          });
          await sendLineMessage(r.line_user_id, text);
        }
      } catch {
        // LINE 推播失敗不影響主流程，後台仍可手動複製
      }
    }

    return NextResponse.json({ ok: true });
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
