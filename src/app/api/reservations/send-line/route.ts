import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLineMessage, buildPaymentMessage } from "@/lib/line";
import { isAdminConfigured } from "@/lib/supabase-admin";

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
    .select("line_user_id, customer_name, start_time, end_time, total_price, rooms(name, branches(name))")
    .eq("id", id)
    .single();

  if (fetchErr || !r) {
    return NextResponse.json({ error: "找不到訂位資料" }, { status: 404 });
  }

  if (!r.line_user_id) {
    return NextResponse.json({ error: "客人尚未綁定 LINE，請客人在訂位成功頁點「用 LINE 登入綁定通知」後再試" }, { status: 422 });
  }

  if (r.total_price == null) {
    return NextResponse.json({ error: "此訂位尚未設定總金額，請先在後台編輯填入金額" }, { status: 422 });
  }

  const room = Array.isArray(r.rooms) ? r.rooms[0] : r.rooms;
  const branch = Array.isArray(room?.branches) ? room.branches[0] : room?.branches;
  const branchName = branch?.name ?? "";

  const text = buildPaymentMessage({
    customerName: r.customer_name,
    startTime: r.start_time,
    endTime: r.end_time,
    total: Number(r.total_price),
    branchName,
  });

  try {
    await sendLineMessage(r.line_user_id, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LINE 發送失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
