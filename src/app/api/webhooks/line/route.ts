import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLineMessage } from "@/lib/line";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const BOOKING_CODE_RE = /^[A-Z0-9]{6}$/;

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
    const rawText = event.message.text?.trim() ?? "";
    const upperText = rawText.toUpperCase();
    const replyToken = event.replyToken;

    if (!userId || !rawText) continue;

    // 第一層：訂位代號綁定
    if (BOOKING_CODE_RE.test(upperText)) {
      const { data: reservation } = await supabaseAdmin()
        .from("reservations")
        .select("id, status")
        .eq("booking_code", upperText)
        .single();

      if (!reservation) {
        if (replyToken) {
          await replyMessage(
            replyToken,
            "查無此訂位代號，請確認代號是否正確（請輸入6碼大寫英數字）。"
          );
        }
        continue;
      }

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
      continue;
    }

    // 第二層：付款回報通知
    const { data: reservation } = await supabaseAdmin()
      .from("reservations")
      .select("id, booking_code, customer_name, start_time, end_time")
      .eq("line_user_id", userId)
      .in("status", ["confirmed", "pending"])
      .order("start_time", { ascending: true })
      .limit(1)
      .single();

    if (!reservation) {
      if (replyToken) {
        await replyMessage(
          replyToken,
          "您好！請先傳送您的訂位代號（6碼英數字）給我們，完成綁定後即可回報付款。"
        );
      }
      continue;
    }

    // 轉發付款通知到 LINE 群組
    const groupId = process.env.LINE_GROUP_ID;
    if (groupId) {
      const startDate = parseISO(reservation.start_time);
      const endDate = parseISO(reservation.end_time);
      const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
      const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;

      const groupText =
        `💰 客人回報付款\n` +
        `姓名：${reservation.customer_name}\n` +
        `代號：${reservation.booking_code}\n` +
        `時間：${formattedDate} ${timeRange}\n` +
        `客人傳來：「${rawText}」`;

      try {
        await sendLineMessage(groupId, groupText);
      } catch {
        // 群組通知失敗不影響回覆客人
      }
    }

    if (replyToken) {
      await replyMessage(
        replyToken,
        "已收到您的付款通知，我們將盡快確認並更新訂位狀態，謝謝！"
      );
    }
  }

  return NextResponse.json({ ok: true });
}
