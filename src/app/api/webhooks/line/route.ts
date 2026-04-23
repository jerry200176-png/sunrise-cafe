import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function replyMessage(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  await fetch(REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return false;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: {
    events: {
      type: string;
      replyToken?: string;
      source: { userId?: string };
      message?: { type: string; text?: string };
    }[];
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  for (const event of payload.events ?? []) {
    if (event.type !== "message") continue;
    if (event.message?.type !== "text") continue;

    const userId = event.source.userId;
    const text = event.message.text?.trim().toUpperCase() ?? "";
    const replyToken = event.replyToken;

    if (!userId || !text) continue;

    // 查詢是否有符合的訂位代號
    const { data: reservation } = await supabaseAdmin()
      .from("reservations")
      .select("id, status")
      .eq("booking_code", text)
      .single();

    if (!reservation) {
      if (replyToken) {
        await replyMessage(
          replyToken,
          "查無此訂位代號，請確認代號是否正確（區分大小寫，請輸入全大寫）。"
        );
      }
      continue;
    }

    // 寫入 line_user_id
    await supabaseAdmin()
      .from("reservations")
      .update({ line_user_id: userId })
      .eq("id", reservation.id);

    const statusMsg =
      reservation.status === "confirmed"
        ? "您的訂位已確認，繳款通知請查看稍早訊息。"
        : "已收到您的訂位代號！店家確認後將自動傳送繳費通知給您，請稍候。";

    if (replyToken) {
      await replyMessage(replyToken, statusMsg);
    }
  }

  return NextResponse.json({ ok: true });
}
