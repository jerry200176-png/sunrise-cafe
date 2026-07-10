import { toTaipei } from "@/lib/datetime";

// Force update: Enable 0.5 hour intervals
export function getDurationOptions() {
  const options = [];
  for (let i = 2; i <= 10; i += 0.5) {
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

/** 依台灣時區判斷是否為週末（週六、週日） */
export function isWeekendDate(dateStr: string): boolean {
  const day = toTaipei(`${dateStr}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

/** 依房間定價與時段計算總價（伺服器端權威來源） */
export function computeReservationTotalPrice(
  room: { price_weekday: number; price_weekend: number },
  startTime: string,
  endTime: string
): number {
  const dateStr = startTime.slice(0, 10);
  const pricePerHour = isWeekendDate(dateStr)
    ? Number(room.price_weekend)
    : Number(room.price_weekday);
  const hours =
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000;
  return Math.round(pricePerHour * hours);
}