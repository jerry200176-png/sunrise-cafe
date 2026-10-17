/**
 * 訂金期限邏輯（到期前提醒；逾期只顯示狀態，不取消訂位）
 *
 * ADR-012（Founder 2026-10-16）：未付訂金不再自動取消訂位。期限只用於提醒
 * 與顯示；逾期後訂位保留為未付訂金，由店家決定是否聯繫或手動取消。
 *
 * 期限公式（2026-08-14 調整，見 docs/DECISIONS.md ADR-011）：
 * 訂金繳款期限 = max(建立訂位起 48 小時, 訂位開始前 6 小時)，並以「訂位開始時間」封頂。
 *
 * 舊規則是 min(建立時間+24h, 訂位開始時間)：訂位本身若很臨時（例如開始前 1–3
 * 小時才訂），期限會被壓縮到只剩幾十分鐘甚至已經過期，等於臨時訂位幾乎不可能
 * 在期限內繳訂金。新規則保證：
 *   - 不論何時下訂，期限一律不早於「訂位開始前 6 小時」（給臨時訂位足夠時間）
 *   - 不論何時下訂，期限一律不晚於訂位開始時間本身（不會要求已經到場後才繳費）
 *   - 一般提前下訂的情況，給足 48 小時（而非舊制的 24 小時）
 */
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";

const DEADLINE_HOURS_FROM_CREATION = 48;
const MIN_GRACE_HOURS_BEFORE_START = 6;
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
  const fromCreation = createdMs + DEADLINE_HOURS_FROM_CREATION * HOUR_MS;
  const floorBeforeStart = startMs - MIN_GRACE_HOURS_BEFORE_START * HOUR_MS;
  const deadline = Math.max(fromCreation, floorBeforeStart);
  return new Date(Math.min(deadline, startMs));
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

/**
 * 目前「可能」需要發訂金提醒的訂位，其 start_time 一定落在 (now, now + 30h]。
 * 供 Cron 查詢縮小範圍，避免逾期未付（ADR-012 起永遠不會被取消）的舊訂位
 * 塞滿 API 回傳上限，餓死真正該提醒的訂位（#468 review）。
 *
 * 推導（只用本檔的規則，常數改了範圍會跟著變）：
 * - deadline = min(max(created + 48h, start − 6h), start)，所以
 *   start − MIN_GRACE_HOURS_BEFORE_START ≤ deadline ≤ start。
 * - 首次提醒與迫近提醒都要求 0 < deadline − now ≤ REMINDER_WINDOW_HOURS
 *   （迫近的 URGENCY_SOON_HOURS 視窗更小）。
 * - deadline > now ⇒ start > now；deadline ≤ now + 24h ⇒ start ≤ now + 24h + 6h。
 * 此範圍是必要條件，不是充分條件；最終仍由 shouldSend* 判斷。
 */
export function depositReminderStartWindow(now: Date = new Date()): { startAfter: Date; startAtOrBefore: Date } {
  const horizonHours = Math.max(REMINDER_WINDOW_HOURS, URGENCY_SOON_HOURS) + MIN_GRACE_HOURS_BEFORE_START;
  return {
    startAfter: new Date(now.getTime()),
    startAtOrBefore: new Date(now.getTime() + horizonHours * HOUR_MS),
  };
}

/**
 * 是否已過訂金期限。只供顯示與 LINE Pay 線上付款的既有限制使用；
 * 逾期不代表要取消訂位（ADR-012）。
 */
export function isDepositDeadlinePast(deadline: Date, now: Date = new Date()): boolean {
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
