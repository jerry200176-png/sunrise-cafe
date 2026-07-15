/**
 * LINE Flex 卡片建構器 — 客人 Bot + 群組 Bot 統一入口
 */
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";
import {
  flexBubble,
  LINE_BOOK_URL,
  LINE_BRAND,
  LINE_QUERY_URL,
  LINE_SITE_URL,
  type FlexRow,
  type LineFlexContainer,
} from "@/lib/line-flex";
import { resolveStoreName, type BranchPaymentConfig } from "@/lib/payment-message";
import {
  computeDepositDeadline,
  formatDepositDeadlineLabel,
} from "@/lib/deposit-deadline";
import {
  GUEST_REPLY_PAYMENT_PENDING_REVIEW,
  GUEST_REPLY_PAYMENT_AUTO_RECORDED,
} from "@/lib/payment-events";

export const WAITLIST_CONFIRM_WINDOW_MINUTES = 30;

function dateTimeRows(startTime: string, endTime: string, extra: FlexRow[] = []): FlexRow[] {
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  return [{ label: "日期", value: formattedDate }, { label: "時段", value: timeRange }, ...extra];
}

function reservationRows(params: {
  customerName?: string;
  phone?: string;
  bookingCode?: string;
  startTime?: string;
  endTime?: string;
  guestCount?: number | null;
  notes?: string | null;
  roomLabel?: string;
}): FlexRow[] {
  const rows: FlexRow[] = [];
  if (params.customerName) rows.push({ label: "姓名", value: params.customerName });
  if (params.phone) rows.push({ label: "電話", value: params.phone });
  if (params.bookingCode) rows.push({ label: "訂位碼", value: params.bookingCode });
  if (params.startTime && params.endTime) {
    rows.push(...dateTimeRows(params.startTime, params.endTime));
  }
  if (params.roomLabel) rows.push({ label: "包廂", value: params.roomLabel });
  if (params.guestCount) rows.push({ label: "人數", value: `${params.guestCount} 人` });
  if (params.notes?.trim()) rows.push({ label: "備註", value: params.notes.trim() });
  return rows;
}

// ─── 客人 Bot ─────────────────────────────────────────────

export function buildPaymentFlex(params: {
  customerName: string;
  startTime: string;
  endTime: string;
  total: number;
  branch: BranchPaymentConfig;
  bookingCode?: string | null;
  /** 建立時間；用於顯示真實訂金截止（與 deposit-deadline 規則一致） */
  createdAt?: string | null;
}): LineFlexContainer {
  const deposit = Math.ceil(params.total / 2);
  const storeName = resolveStoreName(params.branch);
  const code = params.bookingCode?.trim();
  const paymentInfo = params.branch.payment_info?.trim();
  const linePayUrl = params.branch.line_pay_url?.trim();

  const deadlineLabel = params.createdAt
    ? formatDepositDeadlineLabel(computeDepositDeadline(params.createdAt, params.startTime))
    : null;

  const rows: FlexRow[] = [
    ...(code ? [{ label: "訂位碼", value: code }] : []),
    ...dateTimeRows(params.startTime, params.endTime),
    { label: "總金額", value: `$${params.total}` },
    { label: "訂金", value: `$${deposit}` },
    ...(deadlineLabel ? [{ label: "繳款期限", value: deadlineLabel }] : []),
  ];

  const paragraphs = [`${params.customerName} 您好，已為您保留包廂`];
  let note = deadlineLabel
    ? `請於 ${deadlineLabel} 前完成訂金付款，逾期座位將自動釋放。`
    : "請於期限內（最晚建立後 24 小時或訂位開始前）完成訂金付款，逾期座位將自動釋放。";
  if (paymentInfo) {
    note = `${paymentInfo.replace(/\n/g, " · ")}\n\n${
      code
        ? `匯款後請回傳：${code} 末五碼（可附截圖）`
        : "匯款後請回傳訂位碼與末五碼（可附截圖）"
    }`;
    if (deadlineLabel) {
      note = `繳款期限：${deadlineLabel}\n\n${note}`;
    }
  }
  note += "\n\n帶外食沒關係，離場請自行帶走垃圾；未帶走酌收清潔費 $300。";

  return flexBubble({
    icon: "💳",
    title: "訂金繳費通知",
    subtitle: storeName,
    accentColor: LINE_BRAND.caramel,
    paragraphs,
    rows,
    note,
    primaryAction: linePayUrl
      ? { label: "LINE Pay 付款", uri: linePayUrl, color: LINE_BRAND.caramelDeep }
      : { label: "查看訂位詳情", uri: LINE_QUERY_URL },
    secondaryAction: linePayUrl ? { label: "查看訂位詳情", uri: LINE_QUERY_URL } : undefined,
    showSiteLink: true,
  });
}

export function buildReminderFlex(params: {
  leadLabel: string;
  branchName: string;
  roomName?: string | null;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  const rows = dateTimeRows(params.startTime, params.endTime);
  if (params.roomName) rows.push({ label: "包廂", value: params.roomName });

  return flexBubble({
    icon: "📅",
    title: `${params.leadLabel}訂位提醒`,
    subtitle: params.branchName,
    accentColor: LINE_BRAND.caramel,
    paragraphs: ["期待您的光臨！"],
    rows,
    note: "如需調整請提早告知，謝謝！",
    primaryAction: { label: "查看我的訂位", uri: LINE_QUERY_URL },
    showSiteLink: true,
  });
}

export function buildWaitlistFlex(params: {
  startTime: string;
  endTime: string;
  confirmToken: string;
}): LineFlexContainer {
  const confirmUrl = `${LINE_SITE_URL}/book/waitlist/confirm?token=${params.confirmToken}`;

  return flexBubble({
    icon: "🎉",
    title: "候補時段空出",
    subtitle: "請把握確認時間",
    accentColor: LINE_BRAND.successBright,
    paragraphs: ["您等位的包廂時段已釋出！"],
    rows: dateTimeRows(params.startTime, params.endTime),
    note: `請在 ${WAITLIST_CONFIRM_WINDOW_MINUTES} 分鐘內確認，逾時將釋出給下一位候補。`,
    primaryAction: { label: "立即確認訂位", uri: confirmUrl, color: LINE_BRAND.successBright },
  });
}

export function buildGuestBindSuccessFlex(opts: {
  confirmed: boolean;
  paymentSent?: boolean;
}): LineFlexContainer {
  const { confirmed, paymentSent } = opts;
  let paragraph: string;
  if (paymentSent) {
    paragraph = "已為您傳送訂金繳費通知，請依訊息完成付款。";
  } else if (confirmed) {
    paragraph = "您的訂位已確認，繳費通知請查看稍早訊息。";
  } else {
    paragraph = "店家確認後將自動傳送繳費通知，請稍候。";
  }

  return flexBubble({
    icon: confirmed || paymentSent ? "✅" : "🔗",
    title: confirmed || paymentSent ? "LINE 已連結" : "訂位代號已收到",
    subtitle: "昇昇咖啡",
    accentColor: LINE_BRAND.success,
    paragraphs: [paragraph],
    primaryAction: { label: "查看訂位狀態", uri: LINE_QUERY_URL },
    showSiteLink: true,
  });
}

export function buildGuestBindErrorFlex(kind: "not_found" | "phone_prompt" | "phone_mismatch"): LineFlexContainer {
  const map = {
    not_found: {
      title: "找不到訂位",
      text: "請確認 6 碼訂位代號是否正確（大寫英數字）。",
      icon: "🔍",
    },
    phone_prompt: {
      title: "請驗證手機",
      text: "請傳送「訂位代號 + 手機號碼」，例如：\nABC123 0912345678",
      icon: "📱",
    },
    phone_mismatch: {
      title: "手機不符",
      text: "手機號碼與訂位資料不符，請確認後再試。",
      icon: "⚠️",
    },
  }[kind];

  return flexBubble({
    icon: map.icon,
    title: map.title,
    subtitle: "LINE 帳號綁定",
    accentColor: LINE_BRAND.warning,
    paragraphs: [map.text],
    primaryAction: { label: "查詢訂位", uri: LINE_QUERY_URL },
    secondaryAction: { label: "重新預約", uri: LINE_BOOK_URL },
  });
}

export function buildGuestPaymentPendingFlex(): LineFlexContainer {
  return flexBubble({
    icon: "📋",
    title: "付款已收到",
    subtitle: "等待店家確認",
    accentColor: LINE_BRAND.caramel,
    paragraphs: [GUEST_REPLY_PAYMENT_PENDING_REVIEW],
    note: "審核完成後會再通知您，無需重複傳送。",
    primaryAction: { label: "查看訂位", uri: LINE_QUERY_URL },
  });
}

export function buildGuestPaymentApprovedFlex(params: {
  customerName: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "✅",
    title: "訂金已確認",
    subtitle: `${params.customerName} 您好`,
    accentColor: LINE_BRAND.successBright,
    paragraphs: ["感謝您完成付款，我們已為您保留座位。"],
    rows: [
      { label: "訂位碼", value: params.bookingCode },
      ...dateTimeRows(params.startTime, params.endTime),
    ],
    primaryAction: { label: "查看訂位詳情", uri: LINE_QUERY_URL },
    showSiteLink: true,
  });
}

export function buildGuestDepositReminderFlex(params: {
  branchName: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "⏰",
    title: "訂金提醒",
    subtitle: params.branchName,
    accentColor: LINE_BRAND.warning,
    paragraphs: ["您的包廂預約尚未收到訂金。"],
    rows: [
      { label: "訂位碼", value: params.bookingCode },
      ...dateTimeRows(params.startTime, params.endTime),
    ],
    note: "請盡快完成匯款或 LINE Pay（資訊請參考先前訊息），逾期座位將自動釋放。",
    primaryAction: { label: "查看付款資訊", uri: LINE_QUERY_URL },
  });
}

export function buildGuestDepositReleasedFlex(params: {
  branchName: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "😔",
    title: "訂位已釋放",
    subtitle: params.branchName,
    accentColor: LINE_BRAND.danger,
    paragraphs: ["很抱歉，因逾期未收到訂金，座位已自動釋放。"],
    rows: [
      { label: "訂位碼", value: params.bookingCode },
      ...dateTimeRows(params.startTime, params.endTime),
    ],
    note: "如仍需訂位，歡迎重新預約。",
    primaryAction: { label: "重新預約", uri: LINE_BOOK_URL },
    showSiteLink: true,
  });
}

export function buildReviewInviteFlex(params: {
  customerName: string;
  branchName: string;
  reviewUrl: string;
}): LineFlexContainer {
  const storeName = params.branchName.includes("大安") ? "昇昇咖啡 (大安店)" : "昇昇咖啡";
  return flexBubble({
    icon: "⭐",
    title: "感謝光臨",
    subtitle: storeName,
    accentColor: LINE_BRAND.caramel,
    paragraphs: [
      `${params.customerName} 您好，若您喜歡今天的體驗，能否花 30 秒給我們一個 Google 評論？對小店真的很有幫助 🙏`,
    ],
    primaryAction: { label: "留下評論", uri: params.reviewUrl, color: LINE_BRAND.caramelDeep },
    note: "期待您下次再來！",
    showSiteLink: true,
  });
}

/** @deprecated 使用 buildReviewInviteFlex */
export function buildReviewInviteMessage(params: {
  customerName: string;
  branchName: string;
  reviewUrl: string;
}): string {
  const storeName = params.branchName.includes("大安") ? "昇昇咖啡 (大安店)" : "昇昇咖啡";
  return (
    `${params.customerName} 您好，感謝您今天光臨${storeName}！\n\n` +
    `若您喜歡這次的體驗，能否花 30 秒給我們一個 Google 評論？對小店真的很有幫助 🙏\n` +
    `${params.reviewUrl}\n\n期待您下次再來！`
  );
}

// ─── 群組 Bot ─────────────────────────────────────────────

export function buildNewBookingFlex(params: {
  customerName: string;
  phone: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  guestCount?: number | null;
  notes?: string | null;
}): LineFlexContainer {
  return flexBubble({
    icon: "📩",
    title: "新訂位申請",
    subtitle: params.bookingCode,
    accentColor: LINE_BRAND.caramel,
    rows: reservationRows(params),
    primaryAction: { label: "開啟後台", uri: `${LINE_SITE_URL}/admin` },
  });
}

export function buildPaymentConfirmedFlex(params: {
  customerName: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  rawText: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "💰",
    title: "客人已付訂金",
    subtitle: params.customerName,
    accentColor: LINE_BRAND.successBright,
    rows: [
      { label: "訂位碼", value: params.bookingCode },
      ...dateTimeRows(params.startTime, params.endTime),
      { label: "客人傳來", value: params.rawText },
    ],
    primaryAction: { label: "付款審核", uri: `${LINE_SITE_URL}/admin/payments` },
  });
}

export function buildPaymentPendingReviewGroupFlex(params: {
  customerName: string;
  bookingCode: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "📋",
    title: "付款待確認",
    subtitle: params.customerName,
    accentColor: LINE_BRAND.warning,
    rows: [{ label: "訂位碼", value: params.bookingCode }],
    note: "請至後台「付款審核」核對截圖或匯款資訊。",
    primaryAction: { label: "前往審核", uri: `${LINE_SITE_URL}/admin/payments` },
  });
}

export function buildDepositReleasedGroupFlex(params: {
  customerName: string;
  phone: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "⏰",
    title: "訂金逾期釋放",
    subtitle: "已自動取消",
    accentColor: LINE_BRAND.danger,
    rows: reservationRows(params),
  });
}

export function buildRescheduleGroupFlex(params: {
  customerName: string;
  phone: string;
  bookingCode: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
}): LineFlexContainer {
  const oldRows = dateTimeRows(params.oldStart, params.oldEnd);
  const newRows = dateTimeRows(params.newStart, params.newEnd);
  return flexBubble({
    icon: "📅",
    title: "客人自行改期",
    subtitle: params.bookingCode,
    accentColor: LINE_BRAND.caramel,
    rows: [
      { label: "姓名", value: params.customerName },
      { label: "電話", value: params.phone },
      { label: "原時段", value: `${oldRows[0].value} ${oldRows[1].value}` },
      { label: "新時段", value: `${newRows[0].value} ${newRows[1].value}` },
    ],
    primaryAction: { label: "查看後台", uri: `${LINE_SITE_URL}/admin` },
  });
}

export function buildWaitlistBookedGroupFlex(params: {
  customerName: string;
  phone: string;
  bookingCode: string;
  roomLabel: string;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  return flexBubble({
    icon: "🎉",
    title: "候補轉正式訂位",
    subtitle: params.bookingCode,
    accentColor: LINE_BRAND.successBright,
    rows: reservationRows({
      customerName: params.customerName,
      phone: params.phone,
      bookingCode: params.bookingCode,
      startTime: params.startTime,
      endTime: params.endTime,
      roomLabel: params.roomLabel,
    }),
    primaryAction: { label: "開啟後台", uri: `${LINE_SITE_URL}/admin` },
  });
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

/** LINE carousel 單則上限 12 bubbles */
export const REMINDER_DIGEST_CAROUSEL_MAX = 12;

/** 明日訂位 digest — 單則 carousel（超過上限時請用 buildReminderDigestFlexChunks） */
export function buildReminderDigestFlex(reservations: ReminderRow[]): LineFlexContainer {
  const bubbles = reservations.slice(0, REMINDER_DIGEST_CAROUSEL_MAX).map((r) => {
    const rows = reservationRows({
      customerName: r.customer_name,
      phone: r.phone,
      roomLabel: `${r.branch_name} — ${r.room_name}`,
      startTime: r.start_time,
      endTime: r.end_time,
      guestCount: r.guest_count,
      notes: r.notes,
    });
    return flexBubble({
      icon: "📅",
      title: r.booking_code,
      subtitle: "明日訂位",
      accentColor: LINE_BRAND.caramel,
      rows,
    });
  });
  return { type: "carousel", contents: bubbles };
}

/** 將明日 digest 切成多則 carousel，避免 >12 筆被靜默截斷卻仍標 is_notified */
export function buildReminderDigestFlexChunks(reservations: ReminderRow[]): LineFlexContainer[] {
  if (reservations.length === 0) return [];
  const chunks: LineFlexContainer[] = [];
  for (let i = 0; i < reservations.length; i += REMINDER_DIGEST_CAROUSEL_MAX) {
    chunks.push(buildReminderDigestFlex(reservations.slice(i, i + REMINDER_DIGEST_CAROUSEL_MAX)));
  }
  return chunks;
}

// Re-export guest auto-recorded text for webhook edge cases
export { GUEST_REPLY_PAYMENT_AUTO_RECORDED };
