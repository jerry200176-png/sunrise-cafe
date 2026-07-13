import {
  buildPaymentFlex,
  buildReminderFlex,
  buildWaitlistFlex,
  buildReviewInviteFlex,
  buildReviewInviteMessage,
  WAITLIST_CONFIRM_WINDOW_MINUTES,
} from "@/lib/line-cards";
import type { LineFlexContainer } from "@/lib/line-flex";

export {
  buildPaymentFlex,
  buildReminderFlex,
  buildWaitlistFlex,
  buildReviewInviteFlex,
  buildReviewInviteMessage,
  WAITLIST_CONFIRM_WINDOW_MINUTES,
};
export { buildPaymentMessage } from "@/lib/payment-message";
export type { BranchPaymentConfig } from "@/lib/payment-message";
export type { LineFlexContainer } from "@/lib/line-flex";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

async function lineCustomerFetch(body: Record<string, unknown>): Promise<void> {
  const token = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CUSTOMER_ACCESS_TOKEN 未設定");

  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE push 失敗：${res.status} ${text}`);
  }
}

export async function sendLineMessage(lineUserId: string, text: string): Promise<void> {
  await lineCustomerFetch({
    to: lineUserId,
    messages: [{ type: "text", text }],
  });
}

export async function sendLineFlexMessage(
  lineUserId: string,
  altText: string,
  contents: LineFlexContainer
): Promise<void> {
  await lineCustomerFetch({
    to: lineUserId,
    messages: [{ type: "flex", altText, contents }],
  });
}

/** Webhook 回覆 Flex 卡片（客人 Bot） */
export async function replyLineFlexMessage(
  replyToken: string,
  altText: string,
  contents: LineFlexContainer
): Promise<void> {
  const token = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) return;

  const res = await fetch(REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "flex", altText, contents }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE reply flex 失敗：${res.status} ${text}`);
  }
}

/** Webhook 回覆純文字（僅用於無 replyToken 或 fallback） */
export async function replyLineTextMessage(replyToken: string, text: string): Promise<void> {
  const token = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) return;

  const res = await fetch(REPLY_URL, {
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

  if (!res.ok) {
    const textBody = await res.text();
    throw new Error(`LINE reply 失敗：${res.status} ${textBody}`);
  }
}
