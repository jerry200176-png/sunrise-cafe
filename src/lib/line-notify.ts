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
import {
  decideLineUsage,
  fetchLineQuotaSnapshot,
  readLineUsageBudget,
  type LineNotificationPriority,
} from "@/lib/line-usage";
import { observeLineProviderRejection } from "@/lib/line-provider-observability";
import { tokenForGroup } from "@/lib/line-group-bots";

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

export type LineSendOptions = {
  retryKey?: string;
  priority?: LineNotificationPriority;
  projectedMessages?: number;
};

export type LineFlexMessage = {
  altText: string;
  contents: LineFlexContainer;
};

/** LINE accepts at most five message objects in one push request. */
export const LINE_PUSH_MESSAGE_MAX = 5;

export class LineInformationalSuppressedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`LINE informational notification suppressed: ${reason}`);
    this.name = "LineInformationalSuppressedError";
    this.reason = reason;
  }
}

function lineHeaders(token: string, options?: LineSendOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (options?.retryKey) headers["X-Line-Retry-Key"] = options.retryKey;
  return headers;
}

async function sendGroupPayload(
  groupId: string,
  messages: Record<string, unknown>[],
  options?: LineSendOptions
): Promise<void> {
  const { token: defaultToken } = getLineConfig();
  if (!defaultToken) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  // A branch with its own Official Account pushes from that account (its own quota).
  const token = await tokenForGroup(groupId, defaultToken);

  const budget = readLineUsageBudget();
  if (
    budget.enabled &&
    options?.priority === "informational" &&
    (budget.monthlyBudget || budget.expectedDaily)
  ) {
    const snapshot = await fetchLineQuotaSnapshot(token);
    const decision = decideLineUsage(
      options.priority,
      snapshot,
      budget,
      options.projectedMessages ?? 1
    );
    if (!decision.allowed) throw new LineInformationalSuppressedError(decision.reason);
  }

  const res = await fetch(LINE_API_URL, {
    method: "POST",
    headers: lineHeaders(token, options),
    body: JSON.stringify({ to: groupId, messages }),
  });
  if (res.status === 409 && options?.retryKey) {
    const acceptedReqId = res.headers.get("x-line-accepted-request-id");
    console.info(
      `[line-notify] 409 Conflict: retryKey ${options.retryKey} already accepted by LINE Platform (acceptedReqId: ${acceptedReqId})`
    );
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    observeLineProviderRejection({
      channel: "group",
      operation: "push",
      status: res.status,
      retryKey: options?.retryKey,
    });
    throw new Error(`LINE API 錯誤 (${res.status}): ${body}`);
  }
}

export async function sendLineMessageToGroup(
  text: string,
  groupId: string,
  options?: LineSendOptions
): Promise<void> {
  return sendGroupPayload(groupId, [{ type: "text", text }], options);
}

export async function sendLineMessage(text: string, options?: LineSendOptions): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineMessageToGroup(text, groupId, options);
}

export async function sendLineFlexToGroup(
  altText: string,
  contents: LineFlexContainer,
  groupId: string,
  options?: LineSendOptions
): Promise<void> {
  return sendGroupPayload(groupId, [{ type: "flex", altText, contents }], options);
}

/**
 * Send several group Flex notifications in one push request. LINE limits a
 * request to five message objects; callers must chunk larger batches.
 */
export async function sendLineFlexBatchToGroup(
  messages: LineFlexMessage[],
  groupId: string,
  options?: LineSendOptions
): Promise<void> {
  if (messages.length === 0) return;
  if (messages.length > LINE_PUSH_MESSAGE_MAX) {
    throw new Error(`LINE 批次最多 ${LINE_PUSH_MESSAGE_MAX} 則訊息`);
  }
  return sendGroupPayload(
    groupId,
    messages.map((message) => ({
      type: "flex",
      altText: message.altText,
      contents: message.contents,
    })),
    options
  );
}

export async function sendLineFlex(
  altText: string,
  contents: LineFlexContainer,
  options?: LineSendOptions
): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineFlexToGroup(altText, contents, groupId, options);
}

/** Branch group when the branch has one, else the default LINE_GROUP_ID group. */
export async function sendLineFlexToBranchGroup(
  altText: string,
  contents: LineFlexContainer,
  branchGroupId: string | null | undefined,
  options?: LineSendOptions
): Promise<void> {
  if (branchGroupId?.trim()) return sendLineFlexToGroup(altText, contents, branchGroupId.trim(), options);
  return sendLineFlex(altText, contents, options);
}

/** Batch helper using the legacy LINE_GROUP_ID fallback. */
export async function sendLineFlexBatch(
  messages: LineFlexMessage[],
  options?: LineSendOptions
): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineFlexBatchToGroup(messages, groupId, options);
}
