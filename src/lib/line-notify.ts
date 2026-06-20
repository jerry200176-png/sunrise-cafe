/**
 * LINE Messaging API — Push Message 推播工具
 * 使用 LINE Official Account 的 Messaging API 將訊息推送到指定群組或用戶
 */

import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";
import { flexHeader, flexRow, type LineFlexContainer } from "@/lib/line-flex";

const LINE_API_URL = "https://api.line.me/v2/bot/message/push";

function getLineConfig() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  return { token, groupId };
}

/** 是否已設定 LINE 環境變數 */
export function isLineConfigured(): boolean {
  const { token, groupId } = getLineConfig();
  return Boolean(token && groupId);
}

/** 發送文字訊息到指定 LINE 群組（明確傳入 groupId） */
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

/** 發送文字訊息到 LINE 群組（使用 LINE_GROUP_ID 環境變數，向下相容） */
export async function sendLineMessage(text: string): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineMessageToGroup(text, groupId);
}

/** 發送 Flex Message 到指定 LINE 群組（明確傳入 groupId） */
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

/** 發送 Flex Message 到 LINE 群組（使用 LINE_GROUP_ID 環境變數，向下相容） */
export async function sendLineFlex(altText: string, contents: LineFlexContainer): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }
  return sendLineFlexToGroup(altText, contents, groupId);
}

function dateTimeLabels(startTime: string, endTime: string) {
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  return {
    dateLabel: format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW }),
    timeLabel: `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`,
  };
}

/** 建立「新訂位申請」群組通知卡片 */
export function buildNewBookingFlex(params: {
  customerName: string;
  phone: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  guestCount?: number | null;
  notes?: string | null;
}): LineFlexContainer {
  const { dateLabel, timeLabel } = dateTimeLabels(params.startTime, params.endTime);
  const rows = [
    flexRow("姓名", params.customerName),
    flexRow("電話", params.phone),
    flexRow("代號", params.bookingCode),
    flexRow("時間", `${dateLabel} ${timeLabel}`),
    flexRow("人數", params.guestCount ? `${params.guestCount} 人` : "未填"),
  ];
  if (params.notes?.trim()) rows.push(flexRow("備註", params.notes.trim()));

  return {
    type: "bubble",
    header: flexHeader("📩", "新訂位申請", "#D97706"),
    body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
  };
}

/** 建立「客人已付訂金」群組通知卡片 */
export function buildPaymentConfirmedFlex(params: {
  customerName: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  rawText: string;
}): LineFlexContainer {
  const { dateLabel, timeLabel } = dateTimeLabels(params.startTime, params.endTime);
  return {
    type: "bubble",
    header: flexHeader("💰", "客人已付訂金", "#16A34A"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        flexRow("姓名", params.customerName),
        flexRow("代號", params.bookingCode),
        flexRow("時間", `${dateLabel} ${timeLabel}`),
        flexRow("客人傳來", params.rawText),
      ],
    },
  };
}

type ReminderRow = {
  booking_code: string;
  room_name: string;
  branch_name: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  phone: string;
  guest_count?: number | null;
  notes?: string | null;
};

/** 建立「明日訂位提醒」群組通知卡片（多筆訂位以 carousel 呈現，上限 12 筆） */
export function buildReminderDigestFlex(reservations: ReminderRow[]): LineFlexContainer {
  const bubbles = reservations.slice(0, 12).map((r) => {
    const { dateLabel, timeLabel } = dateTimeLabels(r.start_time, r.end_time);
    const rows = [
      flexRow("姓名", r.customer_name),
      flexRow("電話", r.phone),
      flexRow("包廂", `${r.branch_name} — ${r.room_name}`),
      flexRow("時間", `${dateLabel} ${timeLabel}`),
      flexRow("人數", r.guest_count ? `${r.guest_count} 人` : "未填"),
    ];
    if (r.notes?.trim()) rows.push(flexRow("備註", r.notes.trim()));
    return {
      type: "bubble",
      header: flexHeader("📅", r.booking_code, "#D97706"),
      body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
    };
  });
  return { type: "carousel", contents: bubbles };
}

