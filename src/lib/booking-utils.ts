import { isTaiwanHoliday } from "./taiwan-holidays";

// Force update: Enable 0.5 hour intervals
export function getDurationOptions() {
  const options = [];
  for (let i = 1; i <= 10; i += 0.5) {
    options.push(i);
  }
  return options;
}

/**
 * 判斷指定日期是否需收取訂金
 * 條件：週六、週日、或台灣國定假日
 * @param dateStr 格式 YYYY-MM-DD
 */
export function isDepositRequired(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  // 週六(6) 或 週日(0)
  if (day === 0 || day === 6) return true;
  // 國定假日
  return isTaiwanHoliday(dateStr);
}

/**
 * 計算訂金金額（總價的 50%，無條件進位）
 */
export function getDepositAmount(totalPrice: number): number {
  return Math.ceil(totalPrice * 0.5);
}