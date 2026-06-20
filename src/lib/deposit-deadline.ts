/**
 * 訂金到期邏輯（自動釋放未付款訂位 + 到期前提醒）
 *
 * 規則：訂金繳款期限 = 「建立訂位起 24 小時」與「訂位開始時間」兩者較早者
 * （避免訂位本身就在 24 小時內發生時，期限晚於訂位開始）。
 */

const DEADLINE_HOURS = 24;
const REMINDER_WINDOW_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

export function computeDepositDeadline(createdAt: string, startTime: string): Date {
  const createdMs = new Date(createdAt).getTime();
  const startMs = new Date(startTime).getTime();
  return new Date(Math.min(createdMs + DEADLINE_HOURS * HOUR_MS, startMs));
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
