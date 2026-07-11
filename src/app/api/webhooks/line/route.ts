import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLineMessage } from "@/lib/line-notify";
import {
  DEFAULT_PAYMENT_KEYWORDS,
  isPaymentMessage,
  extractBookingCode,
} from "@/lib/payment-keywords";
import {
  getPaymentSubmissionOutcome,
  PAYMENT_IMAGE_PAYLOAD,
  GUEST_REPLY_PAYMENT_PENDING_REVIEW,
  type PaymentEventSource,
} from "@/lib/payment-events";
import { buildLineImagePayload } from "@/lib/payment-event-payload";
import { countPendingPaymentEventsForReservation } from "@/lib/payment-events-admin";
import { logPayment } from "@/lib/payment-log";
import { logOps } from "@/lib/ops-log";
import {
  parseLineBindPayload,
  phonesMatchReservation,
  LINE_BIND_PHONE_PROMPT,
  LINE_BIND_PHONE_MISMATCH,
} from "@/lib/line-bind";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

async function fetchPaymentKeywords(): Promise<string[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/settings?id=eq.app&select=payment_keywords`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return DEFAULT_PAYMENT_KEYWORDS;
    const arr = await res.json();
    const kws = Array.isArray(arr) ? arr[0]?.payment_keywords : null;
    return Array.isArray(kws) && kws.length > 0 ? kws : DEFAULT_PAYMENT_KEYWORDS;
  } catch {
    return DEFAULT_PAYMENT_KEYWORDS;
  }
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

async function handleBookingCode(userId: string, rawText: string, replyToken?: string) {
  const payload = parseLineBindPayload(rawText);
  if (!payload) return;

  const { data: reservation, error } = await supabaseAdmin()
    .from("reservations")
    .select("id, status, phone")
    .eq("booking_code", payload.bookingCode)
    .single();

  if (error || !reservation) {
    console.log(`[webhook] booking code not found: ${payload.bookingCode}`);
    if (replyToken) {
      await replyMessage(replyToken, "查無此訂位代號，請確認代號是否正確（請輸入6碼大寫英數字）。");
    }
    return;
  }

  if (!payload.phone) {
    if (replyToken) await replyMessage(replyToken, LINE_BIND_PHONE_PROMPT);
    return;
  }

  if (!reservation.phone || !phonesMatchReservation(reservation.phone, payload.phone)) {
    if (replyToken) await replyMessage(replyToken, LINE_BIND_PHONE_MISMATCH);
    return;
  }

  const { error: updateErr } = await supabaseAdmin()
    .from("reservations")
    .update({ line_user_id: userId })
    .eq("phone", reservation.phone)
    .neq("status", "cancelled");
  if (updateErr) console.error("[webhook] update line_user_id failed:", updateErr);
  else console.log(`[webhook] bound line_user_id for phone ${reservation.phone}`);

  const statusMsg =
    reservation.status === "confirmed"
      ? "您的訂位已確認，繳款通知請查看稍早訊息。"
      : "已收到您的訂位代號！店家確認後將自動傳送繳費通知給您，請稍候。";

  if (replyToken) await replyMessage(replyToken, statusMsg);
}

type PaymentReservation = {
  id: string;
  booking_code: string;
  customer_name: string;
  start_time: string;
  end_time: string;
};

async function findPaymentReservation(
  userId: string,
  rawText: string
): Promise<PaymentReservation | null> {
  const codeInMessage = extractBookingCode(rawText);
  if (codeInMessage) {
    const { data } = await supabaseAdmin()
      .from("reservations")
      .select("id, booking_code, customer_name, start_time, end_time, line_user_id")
      .eq("booking_code", codeInMessage)
      .in("status", ["confirmed", "pending"])
      .eq("is_deposit_paid", false)
      .single();
    if (!data || data.line_user_id !== userId) return null;
    return data;
  }

  const { data } = await supabaseAdmin()
    .from("reservations")
    .select("id, booking_code, customer_name, start_time, end_time")
    .eq("line_user_id", userId)
    .in("status", ["confirmed", "pending"])
    .eq("is_deposit_paid", false)
    .order("start_time", { ascending: true })
    .limit(1)
    .single();

  return data ?? null;
}

async function handlePaymentReport(
  userId: string,
  rawText: string,
  source: PaymentEventSource,
  replyToken?: string,
  keywords: string[] = DEFAULT_PAYMENT_KEYWORDS
) {
  const reservation = await findPaymentReservation(userId, rawText);

  if (!reservation) return;
  if (source === "line_text" && !isPaymentMessage(rawText, keywords)) return;

  const outcome = getPaymentSubmissionOutcome(source);
  if (outcome !== "pending_review") return;

  try {
    const pending = await countPendingPaymentEventsForReservation(reservation.id);
    if (pending > 0) {
      logPayment("payment_event.duplicate_skipped", {
        reservation_id: reservation.id,
        booking_code: reservation.booking_code,
        pending_count: pending,
      });
      if (replyToken) {
        await replyMessage(replyToken, GUEST_REPLY_PAYMENT_PENDING_REVIEW);
      }
      return;
    }
  } catch (dupErr) {
    console.error("[webhook] pending count check failed:", dupErr);
  }

  const { error: eventErr } = await supabaseAdmin().from("payment_events").insert({
    reservation_id: reservation.id,
    source,
    status: "pending_review",
    raw_payload: rawText,
  });
  if (eventErr) {
    logPayment("payment_event.insert_failed", {
      reservation_id: reservation.id,
      error: eventErr.message,
    });
    if (replyToken) {
      await replyMessage(
        replyToken,
        "已收到您的訊息，但系統暫時無法記錄，請稍後再試或聯繫店家。"
      );
    }
    return;
  }

  logPayment("payment_event.created", {
    reservation_id: reservation.id,
    booking_code: reservation.booking_code,
    source,
  });

  try {
    await sendLineMessage(
      `📋 付款待確認\n` +
        `姓名：${reservation.customer_name}\n` +
        `代號：${reservation.booking_code}\n` +
        `請至後台「付款審核」核對`
    );
  } catch (err) {
    console.error("[webhook] group pending-review notify failed:", err);
  }

  if (replyToken) {
    await replyMessage(replyToken, GUEST_REPLY_PAYMENT_PENDING_REVIEW);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    logOps("webhook", "webhook.signature_failed", {});
    console.error("[webhook] signature verification failed");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: {
    events: {
      type: string;
      replyToken?: string;
      source: { userId?: string };
      message?: { type: string; id?: string; text?: string };
    }[];
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const paymentKeywords = await fetchPaymentKeywords();

  const events = payload.events ?? [];
  for (const event of events) {
    if (event.type !== "message") continue;

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    if (!userId) continue;

    try {
      const msgType = event.message?.type;

      // 客人傳圖片 → 記錄待審核，不直接標記已付（ADR-008）
      if (msgType === "image") {
        const messageId = event.message?.id;
        const payload = messageId ? buildLineImagePayload(messageId) : PAYMENT_IMAGE_PAYLOAD;
        await handlePaymentReport(userId, payload, "line_image", replyToken, paymentKeywords);
        continue;
      }

      if (msgType !== "text") continue;

      const rawText = event.message?.text?.trim() ?? "";
      if (!rawText) continue;

      const bookingCode = extractBookingCode(rawText);
      if (bookingCode) {
        await handleBookingCode(userId, rawText, replyToken);
      } else {
        await handlePaymentReport(userId, rawText, "line_text", replyToken, paymentKeywords);
      }
    } catch (err) {
      logOps("webhook", "webhook.event_error", {
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error("[webhook] event processing error:", err);
      // 不讓單一事件的錯誤影響整體回應
    }
  }

  if (events.length > 0) {
    logOps("webhook", "webhook.event_ok", {
      route: "line",
      event_count: events.length,
    });
  }

  return NextResponse.json({ ok: true });
}
