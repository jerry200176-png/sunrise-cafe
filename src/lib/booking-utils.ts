export {
  getDurationOptions,
  MIN_DURATION_HOURS,
  MAX_DURATION_HOURS,
  SLOT_STEP_MS,
} from "@/lib/slot-grid";

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

/** 將帶時區的時間點換成台北日曆日；無效時間沒有可用日期。 */
export function taipeiDateForInstant(instant: string): string | null {
  if (typeof instant !== "string") return null;
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** 已是台北日曆日（YYYY-MM-DD）；不依瀏覽器或伺服器所在地轉換。 */
export function isWeekendDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateStr) return false;
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** 依房間定價與時段計算總價（伺服器端權威來源） */
export function computeReservationTotalPrice(
  room: { price_weekday: number; price_weekend: number },
  startTime: string,
  endTime: string
): number {
  // Preserve the existing non-string error rather than treating a numeric epoch
  // supplied by an untyped caller as a newly supported request format.
  if (typeof startTime !== "string") throw new TypeError("Invalid start time");
  const dateStr = taipeiDateForInstant(startTime) ?? "";
  const pricePerHour = isWeekendDate(dateStr)
    ? Number(room.price_weekend)
    : Number(room.price_weekday);
  const hours =
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000;
  return Math.round(pricePerHour * hours);
}
