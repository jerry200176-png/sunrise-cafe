import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLineMessage } from "@/lib/line";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const { id } = await request.json() as { id: string };
  if (!id) return NextResponse.json({ error: "缺少訂位 id" }, { status: 400 });

  const { data: r, error: fetchErr } = await supabaseAdmin()
    .from("reservations")
    .select("line_user_id, customer_name, start_time, end_time, total_price, phone, rooms(name, branches(name))")
    .eq("id", id)
    .single();

  if (fetchErr || !r) {
    return NextResponse.json({ error: "找不到訂位資料" }, { status: 404 });
  }

  if (!r.line_user_id) {
    return NextResponse.json({ error: "客人尚未綁定 LINE，請請客人點「一鍵傳送訂位代號」後再試" }, { status: 422 });
  }

  if (r.total_price == null) {
    return NextResponse.json({ error: "此訂位尚未設定總金額，請先在後台編輯填入金額" }, { status: 422 });
  }

  const startDate = parseISO(r.start_time);
  const endDate = parseISO(r.end_time);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const total = Number(r.total_price);
  const deposit = Math.ceil(total / 2);

  const room = Array.isArray(r.rooms) ? r.rooms[0] : r.rooms;
  const branch = Array.isArray(room?.branches) ? room.branches[0] : room?.branches;
  const branchName = branch?.name ?? "";
  const isDaan = branchName.includes("大安");

  const linePayUrl =
    "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";

  const text = isDaan
    ? `您好，這裡是昇昇咖啡 (大安店)。\n\n收到您 ${formattedDate} ${timeRange} 的預約申請（${r.customer_name}）。\n確認該時段有空位，本筆訂單總金額為 $${total}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n【匯款資訊】\n銀行：台北富邦銀行 (012)\n帳號：8212-00000-8489-6\n戶名：昇昇咖啡張文霞\n\n或者您可以使用 LINE Pay 付款：\n${linePayUrl}\n\n匯款後請回傳「末五碼」或「截圖」告知，謝謝！\n\n📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`
    : `您好，這裡是昇昇咖啡。\n\n收到您 ${formattedDate} ${timeRange} 的預約申請（${r.customer_name}）。\n確認該時段有空位，本筆訂單總金額為 $${total}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n請依照官網或現場指示完成付款，並回傳證明，謝謝！\n\n📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`;

  try {
    await sendLineMessage(r.line_user_id, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LINE 發送失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
