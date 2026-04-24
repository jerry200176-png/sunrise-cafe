import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;

  if (!token || !groupId) {
    return NextResponse.json({
      ok: false,
      error: "缺少環境變數",
      hasToken: !!token,
      hasGroupId: !!groupId,
    });
  }

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "text", text: "🔧 LINE 群組測試訊息（系統自動發送，請忽略）" }],
    }),
  });

  const body = await res.text();
  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    lineResponse: body,
    tokenPrefix: token.slice(0, 10) + "...",
    groupId,
  });
}
