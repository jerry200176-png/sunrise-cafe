/**
 * 訂金到期 Cron 的訂位篩選規則（純函式，可單元測試）。
 *
 * 業務流程：客人訂位 → pending → 後台確認 → confirmed → 客人付訂金。
 * 兩種未付款狀態都應納入到期提醒與自動釋放。
 */

/** 尚未完成服務、且可能仍需收訂金的狀態 */
export const DEPOSIT_DEADLINE_STATUSES = ["pending", "confirmed"] as const;

export type DepositDeadlineStatus = (typeof DEPOSIT_DEADLINE_STATUSES)[number];

/**
 * 判斷訂位是否應納入訂金到期 Cron（提醒 / 自動釋放）。
 * 時間判斷（是否逾期）由 deposit-deadline.ts 負責，此處只處理狀態資格。
 */
export function isEligibleForDepositDeadline(
  status: string,
  isDepositPaid: boolean
): boolean {
  if (isDepositPaid) return false;
  return (DEPOSIT_DEADLINE_STATUSES as readonly string[]).includes(status);
}
