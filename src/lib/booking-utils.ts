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
 * 條件：所有日期均需收取訂金
 * @param dateStr 格式 YYYY-MM-DD
 */
export function isDepositRequired(dateStr: string): boolean {
  return !!dateStr;
}

/**
 * 計算訂金金額（總價的 50%，無條件進位）
 */
export function getDepositAmount(totalPrice: number): number {
  return Math.ceil(totalPrice * 0.5);
}