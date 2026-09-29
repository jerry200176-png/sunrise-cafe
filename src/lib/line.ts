import {
  buildPaymentFlex,
  buildReminderFlex,
  buildWaitlistFlex,
  buildReviewInviteFlex,
  buildReviewInviteMessage,
  WAITLIST_CONFIRM_WINDOW_MINUTES,
} from "@/lib/line-cards";
import type { LineFlexContainer } from "@/lib/line-flex";
import { observeLineProviderRejection } from "@/lib/line-provider-observability";
import { branchCustomerBots, customerTokenForBranch } from "@/lib/customer-line-bots";
import { branchIdForReservation, branchIdForRoom } from "@/lib/branch-line-group";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

export type LineCustomerSendOptions = {
  retryKey?: string;
  /** Which store's customer account sends it: the reservation's branch, or a branch directly. */
  reservationId?: string;
  roomId?: string;
  branchId?: string | null;
};

/** Token of the sending store's customer account; the default account when none is configured. */
async function customerSendToken(options?: LineCustomerSendOptions): Promise<string | undefined> {
  if (branchCustomerBots().length === 0) return process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  const db = supabaseAdmin();
  const branchId = options?.branchId
    ?? (options?.reservationId ? await branchIdForReservation(db, options.reservationId) : null)
    ?? (options?.roomId ? await branchIdForRoom(db, options.roomId) : null);
  return customerTokenForBranch(branchId);
}

async function lineCustomerFetch(
  body: Record<string, unknown>,
  options?: LineCustomerSendOptions
): Promise<void> {
  const token = await customerSendToken(options);
  if (!token) throw new Error("LINE_CUSTOMER_ACCESS_TOKEN 未設定");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (options?.retryKey) {
    headers["X-Line-Retry-Key"] = options.retryKey;
  }

  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 409 && options?.retryKey) {
    const acceptedReqId = res.headers.get("x-line-accepted-request-id");
    console.info(
      `[line] 409 Conflict: retryKey ${options.retryKey} already accepted by LINE Platform (acceptedReqId: ${acceptedReqId})`
    );
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    observeLineProviderRejection({
      channel: "customer",
      operation: "push",
      status: res.status,
      retryKey: options?.retryKey,
    });
    throw new Error(`LINE push 失敗：${res.status} ${text}`);
  }
}

export async function sendLineMessage(
  lineUserId: string,
  text: string,
  options?: LineCustomerSendOptions
): Promise<void> {
  await lineCustomerFetch(
    {
      to: lineUserId,
      messages: [{ type: "text", text }],
    },
    options
  );
}

export async function sendLineFlexMessage(
  lineUserId: string,
  altText: string,
  contents: LineFlexContainer,
  options?: LineCustomerSendOptions
): Promise<void> {
  await lineCustomerFetch(
    {
      to: lineUserId,
      messages: [{ type: "flex", altText, contents }],
    },
    options
  );
}

/** Webhook 回覆 Flex 卡片（客人 Bot） */
export async function replyLineFlexMessage(
  replyToken: string,
  altText: string,
  contents: LineFlexContainer,
  /** Token of the account that received the event (a reply token only works with its own channel). */
  channelToken?: string
): Promise<void> {
  const token = channelToken ?? process.env.LINE_CUSTOMER_ACCESS_TOKEN;
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
    observeLineProviderRejection({ channel: "customer", operation: "reply", status: res.status });
    throw new Error(`LINE reply flex 失敗：${res.status} ${text}`);
  }
}

/** Webhook 回覆純文字（僅用於無 replyToken 或 fallback） */
export async function replyLineTextMessage(replyToken: string, text: string, channelToken?: string): Promise<void> {
  const token = channelToken ?? process.env.LINE_CUSTOMER_ACCESS_TOKEN;
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
    observeLineProviderRejection({ channel: "customer", operation: "reply", status: res.status });
    throw new Error(`LINE reply 失敗：${res.status} ${textBody}`);
  }
}
