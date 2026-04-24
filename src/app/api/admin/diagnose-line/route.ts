import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 用法：/api/admin/diagnose-line?code=訂位代號
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "請帶 ?code=訂位代號" }, { status: 400 });
  }

  const { data: r } = await supabaseAdmin()
    .from("reservations")
    .select("id, status, line_user_id, total_price, customer_name, phone")
    .eq("booking_code", code.toUpperCase())
    .single();

  if (!r) {
    return NextResponse.json({ error: "找不到訂位" }, { status: 404 });
  }

  const customerToken = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  let lineTest: { ok: boolean; status: number; body: string } | null = null;

  if (r.line_user_id && customerToken) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        to: r.line_user_id,
        messages: [{ type: "text", text: "🔧 LINE 連線測試（系統自動發送，請忽略）" }],
      }),
    });
    lineTest = { ok: res.ok, status: res.status, body: await res.text() };
  }

  return NextResponse.json({
    booking: {
      id: r.id,
      customer: r.customer_name,
      phone: r.phone,
      status: r.status,
      total_price: r.total_price,
      has_line_id: !!r.line_user_id,
    },
    diagnosis: {
      canSendLine: !!r.line_user_id && r.total_price != null,
      reason: !r.line_user_id
        ? "❌ 客人尚未綁定 LINE"
        : r.total_price == null
          ? "❌ 尚未填入總金額"
          : "✅ 條件齊全，可以發送",
    },
    lineTest,
  });
}
