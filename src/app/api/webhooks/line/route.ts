import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLineFlex, buildPaymentPendingReviewGroupFlex } from "@/lib/line-notify";
import {
  DEFAULT_PAYMENT_KEYWORDS,
  isPaymentMessage,
  extractBookingCode,
} from "@/lib/payment-keywords";
import {
  getPaymentSubmissionOutcome,
  PAYMENT_IMAGE_PAYLOAD,
  type PaymentEventSource,
} from "@/lib/payment-events";
import { buildLineImagePayload } from "@/lib/payment-event-payload";
import { countPendingPaymentEventsForReservation } from "@/lib/payment-events-admin";
import { logPayment } from "@/lib/payment-log";
import { logOps } from "@/lib/ops-log";
import {
  parseLineBindPayload,
  phonesMatchReservation,
} from "@/lib/line-bind";
import {
  replyLineFlexMessage,
  replyLineTextMessage,
} from "@/lib/line";
import {
  buildGuestBindSuccessFlex,
  buildGuestBindErrorFlex,
  buildGuestPaymentPendingFlex,
} from "@/lib/line-cards";
import { sendDepositPaymentRequest } from "@/lib/payment-request-line";

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
  try {
    await replyLineTextMessage(replyToken, text);
  } catch (err) {
    console.error("[webhook] replyMessage failed:", err);
  }
}

async function replyFlex(replyToken: string, altText: string, contents: Record<string, unknown>) {
  try {
    await replyLineFlexMessage(replyToken, altText, contents);
  } catch (err) {
    console.error("[webhook] replyFlex failed:", err);
    await replyMessage(replyToken, altText);
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
      await replyFlex(replyToken, "查無此訂位代號", buildGuestBindErrorFlex("not_found"));
    }
    return;
  }

  if (!payload.phone) {
    if (replyToken) {
      await replyFlex(replyToken, "請驗證手機號碼", buildGuestBindErrorFlex("phone_prompt"));
    }
    return;
  }

  if (!reservation.phone || !phonesMatchReservation(reservation.phone, payload.phone)) {
    if (replyToken) {
      await replyFlex(replyToken, "手機號碼不符", buildGuestBindErrorFlex("phone_mismatch"));
    }
    return;
  }

  const { error: updateErr } = await supabaseAdmin()
    .from("reservations")
    .update({ line_user_id: userId })
    .eq("phone", reservation.phone)
    .neq("status", "cancelled");
  if (updateErr) console.error("[webhook] update line_user_id failed:", updateErr);
  else console.log(`[webhook] bound line_user_id for phone ${reservation.phone}`);

  // If already confirmed with price, deliver the payment Flex now (once)
  const payment = await sendDepositPaymentRequest(reservation.id, { force: false });
  const paymentSentNow = payment.result === "sent";
  const confirmed =
    reservation.status === "confirmed" || paymentSentNow || payment.result === "skipped_already_sent";

  if (replyToken) {
    await replyFlex(
      replyToken,
      confirmed ? "LINE 已連結" : "訂位代號已收到",
      buildGuestBindSuccessFlex({
        confirmed,
        paymentSent: paymentSentNow,
      })
    );
  }
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
        await replyFlex(replyToken, "付款已收到", buildGuestPaymentPendingFlex());
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
    const flex = buildPaymentPendingReviewGroupFlex({
      customerName: reservation.customer_name,
      bookingCode: reservation.booking_code,
    });
    await sendLineFlex(`付款待確認：${reservation.customer_name}`, flex);
  } catch (err) {
    console.error("[webhook] group pending-review notify failed:", err);
  }

  if (replyToken) {
    await replyFlex(replyToken, "付款已收到", buildGuestPaymentPendingFlex());
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

      if (msgType === "image") {
        const messageId = event.message?.id;
        const payloadText = messageId ? buildLineImagePayload(messageId) : PAYMENT_IMAGE_PAYLOAD;
        await handlePaymentReport(userId, payloadText, "line_image", replyToken, paymentKeywords);
        logOps("webhook", "webhook.event_handled", {
          route: "line",
          msg_type: "image",
          event_type: event.type,
        });
        continue;
      }

      if (msgType !== "text") continue;

      const rawText = event.message?.text?.trim() ?? "";
      if (!rawText) continue;

      const bookingCode = extractBookingCode(rawText);
      if (bookingCode) {
        await handleBookingCode(userId, rawText, replyToken);
        logOps("webhook", "webhook.event_handled", {
          route: "line",
          msg_type: "text",
          event_type: event.type,
          handler: "booking_code",
        });
      } else {
        await handlePaymentReport(userId, rawText, "line_text", replyToken, paymentKeywords);
        logOps("webhook", "webhook.event_handled", {
          route: "line",
          msg_type: "text",
          event_type: event.type,
          handler: "payment_report",
        });
      }
    } catch (err) {
      logOps("webhook", "webhook.event_error", {
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error("[webhook] event processing error:", err);
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
