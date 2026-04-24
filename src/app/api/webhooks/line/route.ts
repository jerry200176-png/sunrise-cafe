import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLineMessage as sendLineGroupMessage } from "@/lib/line-notify";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const BOOKING_CODE_RE = /^[A-Z0-9]{6}$/;

function extractBookingCode(text: string): string | null {
  const upper = text.toUpperCase().trim();
  if (BOOKING_CODE_RE.test(upper)) return upper;
  // 處理客人傳來 URL 或 text=代號 的格式
  const match = upper.match(/[?&]TEXT=([A-Z0-9]{6})(?:&|$|\s)/);
  if (match) return match[1];
  return null;
}
const PAYMENT_KEYWORDS = ["末五碼", "五碼", "匯款", "付款", "已付", "已轉", "轉帳", "line pay", "linepay", "截圖", "收款", "轉過去", "付過去"];

function isPaymentMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function replyMessage(replyToken: string, text: string) {
  const token = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) return;
  try {
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
  } catch (err) {
    console.error("[webhook] replyMessage failed:", err);
  }
}

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error("[webhook] LINE_CHANNEL_SECRET is not set");
    return false;
  }
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function handleBookingCode(userId: string, upperText: string, replyToken?: string) {
  const { data: reservation, error } = await supabaseAdmin()
    .from("reservations")
    .select("id, status, phone")
    .eq("booking_code", upperText)
    .single();

  if (error || !reservation) {
    console.log(`[webhook] booking code not found: ${upperText}`);
    if (replyToken) {
      await replyMessage(replyToken, "查無此訂位代號，請確認代號是否正確（請輸入6碼大寫英數字）。");
    }
    return;
  }

  // 更新同電話所有未取消訂位的 line_user_id
  if (reservation.phone) {
    const { error: updateErr } = await supabaseAdmin()
      .from("reservations")
      .update({ line_user_id: userId })
      .eq("phone", reservation.phone)
      .neq("status", "cancelled");
    if (updateErr) console.error("[webhook] update line_user_id failed:", updateErr);
    else console.log(`[webhook] bound line_user_id for phone ${reservation.phone}`);
  }

  const statusMsg =
    reservation.status === "confirmed"
      ? "您的訂位已確認，繳款通知請查看稍早訊息。"
      : "已收到您的訂位代號！店家確認後將自動傳送繳費通知給您，請稍候。";

  if (replyToken) await replyMessage(replyToken, statusMsg);
}

async function handlePaymentReport(userId: string, rawText: string, replyToken?: string) {
  const { data: reservation } = await supabaseAdmin()
    .from("reservations")
    .select("id, booking_code, customer_name, start_time, end_time")
    .eq("line_user_id", userId)
    .in("status", ["confirmed", "pending"])
    .order("start_time", { ascending: true })
    .limit(1)
    .single();

  if (!reservation) return;
  if (!isPaymentMessage(rawText)) return;

  // 自動標記已付訂金
  await supabaseAdmin()
    .from("reservations")
    .update({ is_deposit_paid: true, deposit_payment_note: rawText })
    .eq("id", reservation.id);

  // 通知群組
  try {
    const startDate = parseISO(reservation.start_time);
    const endDate = parseISO(reservation.end_time);
    const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
    const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
    const groupText =
      `💰 客人已付訂金（系統自動標記）\n` +
      `姓名：${reservation.customer_name}\n` +
      `代號：${reservation.booking_code}\n` +
      `時間：${formattedDate} ${timeRange}\n` +
      `客人傳來：「${rawText}」`;
    await sendLineGroupMessage(groupText);
  } catch (err) {
    console.error("[webhook] group notify failed:", err);
  }

  if (replyToken) {
    await replyMessage(replyToken, "已收到您的付款通知，系統已自動記錄，感謝您！");
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    console.error("[webhook] signature verification failed");
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
    const replyToken = event.replyToken;

    if (!userId || !rawText) continue;

    try {
      const bookingCode = extractBookingCode(rawText);
      if (bookingCode) {
        await handleBookingCode(userId, bookingCode, replyToken);
      } else {
        await handlePaymentReport(userId, rawText, replyToken);
      }
    } catch (err) {
      console.error("[webhook] event processing error:", err);
      // 不讓單一事件的錯誤影響整體回應
    }
  }

  return NextResponse.json({ ok: true });
}
