import { NextResponse } from "next/server";

async function testToken(token: string, to: string, label: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text: `🔧 測試訊息（${label}）` }],
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

export async function GET() {
  const groupToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const customerToken = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;

  const result: Record<string, unknown> = {
    env: {
      hasGroupToken: !!groupToken,
      hasCustomerToken: !!customerToken,
      hasGroupId: !!groupId,
      groupTokenPrefix: groupToken?.slice(0, 12) + "...",
      customerTokenPrefix: customerToken?.slice(0, 12) + "...",
      groupId,
    },
  };

  if (groupToken && groupId) {
    result.groupTest = await testToken(groupToken, groupId, "群組");
  }

  return NextResponse.json(result);
}
