/**
 * LINE Messaging API — 群組 Bot 推播
 */
import {
  buildNewBookingFlex,
  buildPaymentConfirmedFlex,
  buildReminderDigestFlex,
  buildReminderDigestFlexChunks,
  buildPaymentPendingReviewGroupFlex,
  buildDepositReleasedGroupFlex,
  buildGuestAttendanceConfirmedGroupFlex,
  buildRescheduleGroupFlex,
  buildWaitlistBookedGroupFlex,
} from "@/lib/line-cards";
import type { LineFlexContainer } from "@/lib/line-flex";

export {
  buildNewBookingFlex,
  buildPaymentConfirmedFlex,
  buildReminderDigestFlex,
  buildReminderDigestFlexChunks,
  buildPaymentPendingReviewGroupFlex,
  buildDepositReleasedGroupFlex,
  buildGuestAttendanceConfirmedGroupFlex,
  buildRescheduleGroupFlex,
  buildWaitlistBookedGroupFlex,
};

const LINE_API_URL = "https://api.line.me/v2/bot/message/push";

function getLineConfig() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  return { token, groupId };
}

export function isLineConfigured(): boolean {
  const { token, groupId } = getLineConfig();
  return Boolean(token && groupId);
}

export async function sendLineMessageToGroup(text: string, groupId: string): Promise<void> {
  const { token } = getLineConfig();
  if (!token) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");

  const res = await fetch(LINE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE API 錯誤 (${res.status}): ${body}`);
  }
}

export async function sendLineMessage(text: string): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineMessageToGroup(text, groupId);
}

export async function sendLineFlexToGroup(
  altText: string,
  contents: LineFlexContainer,
  groupId: string
): Promise<void> {
  const { token } = getLineConfig();
  if (!token) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");

  const res = await fetch(LINE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "flex", altText, contents }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE API 錯誤 (${res.status}): ${body}`);
  }
}

export async function sendLineFlex(altText: string, contents: LineFlexContainer): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineFlexToGroup(altText, contents, groupId);
}
