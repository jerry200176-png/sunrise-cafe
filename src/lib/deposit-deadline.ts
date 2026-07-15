/**
 * 訂金到期邏輯（自動釋放未付款訂位 + 到期前提醒）
 *
 * 規則：訂金繳款期限 = 「建立訂位起 24 小時」與「訂位開始時間」兩者較早者
 * （避免訂位本身就在 24 小時內發生時，期限晚於訂位開始）。
 */
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";

const DEADLINE_HOURS = 24;
const REMINDER_WINDOW_HOURS = 24;
const URGENCY_SOON_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;

export type DepositUrgency = "ok" | "soon" | "past";

export function getDepositUrgency(deadline: Date, now: Date = new Date()): DepositUrgency {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return "past";
  if (ms <= URGENCY_SOON_HOURS * HOUR_MS) return "soon";
  return "ok";
}

export function computeDepositDeadline(createdAt: string, startTime: string): Date {
  const createdMs = new Date(createdAt).getTime();
  const startMs = new Date(startTime).getTime();
  return new Date(Math.min(createdMs + DEADLINE_HOURS * HOUR_MS, startMs));
}

/** 台灣牆鐘顯示：2026/07/16 (三) 20:00 */
export function formatDepositDeadlineLabel(deadline: Date): string {
  const tw = toTaipei(deadline.toISOString());
  return format(tw, "yyyy/MM/dd (EEE) HH:mm", { locale: zhTW });
}

/** 剩餘毫秒（已過期為 0） */
export function depositDeadlineRemainingMs(deadline: Date, now: Date = new Date()): number {
  return Math.max(0, deadline.getTime() - now.getTime());
}

export function shouldAutoRelease(deadline: Date, now: Date = new Date()): boolean {
  return now.getTime() >= deadline.getTime();
}

export function shouldSendDepositReminder(
  deadline: Date,
  reminderSentAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (reminderSentAt) return false;
  const msUntilDeadline = deadline.getTime() - now.getTime();
  return msUntilDeadline > 0 && msUntilDeadline <= REMINDER_WINDOW_HOURS * HOUR_MS;
}

/**
 * Second push when deadline is ≤6h away, after the first 24h-window reminder.
 * Avoids double-send if the first reminder already went out in the soon window
 * (caller should set both `deposit_reminder_sent_at` and `deposit_urgent_reminder_sent_at`).
 */
export function shouldSendUrgentDepositReminder(
  deadline: Date,
  reminderSentAt: string | null | undefined,
  urgentSentAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (urgentSentAt) return false;
  if (!reminderSentAt) return false;
  return getDepositUrgency(deadline, now) === "soon";
}
