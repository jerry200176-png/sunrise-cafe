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

  // 測試群組通知 token（LINE_CHANNEL_ACCESS_TOKEN）
  const groupToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  let groupTest: { ok: boolean; status: number; body: string } | null = null;
  let groupBotInfo: { name?: string; basicId?: string; error?: string } = {};

  if (groupToken) {
    // 查這個 token 屬於哪個帳號
    const infoRes = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${groupToken}` },
    });
    if (infoRes.ok) {
      const info = await infoRes.json() as { displayName?: string; basicId?: string };
      groupBotInfo = { name: info.displayName, basicId: info.basicId };
    } else {
      groupBotInfo = { error: `token 無效 (${infoRes.status})` };
    }

    // 查本月用量
    const quotaRes = await fetch("https://api.line.me/v2/bot/message/quota/consumption", {
      headers: { Authorization: `Bearer ${groupToken}` },
    });
    const quotaBody = quotaRes.ok ? await quotaRes.json() as { totalUsage?: number } : null;
    const limitRes = await fetch("https://api.line.me/v2/bot/message/quota", {
      headers: { Authorization: `Bearer ${groupToken}` },
    });
    const limitBody = limitRes.ok ? await limitRes.json() as { value?: number; type?: string } : null;
    if (quotaBody || limitBody) {
      groupBotInfo = {
        ...groupBotInfo,
        ...({ used: quotaBody?.totalUsage, limit: limitBody?.value, planType: limitBody?.type } as object),
      };
    }
  }

  if (groupToken && groupId) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groupToken}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: "🔧 群組通知測試（系統自動發送，請忽略）" }],
      }),
    });
    groupTest = { ok: res.ok, status: res.status, body: await res.text() };
  } else {
    groupTest = { ok: false, status: 0, body: "缺少 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID" };
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
    groupBotInfo,
    groupTest,
  });
}
