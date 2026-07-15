/**
 * 日期 / 時區工具
 *
 * Vercel 伺服器以 UTC 執行，顯示時間前必須轉成台灣時區，
 * 否則會出現少 8 小時的錯誤（歷史上已多次出包）。
 */

/**
 * 將任意可解析的時間字串轉成「台灣時區當地時間」的 Date。
 *
 * 原理：先以 UTC 解析原字串，再用 toLocaleString 取得台灣當地的
 * 牆上時間字串，最後重新建立 Date。回傳的 Date 其 getHours() 等
 * 方法即為台灣當地時間，可直接交給 date-fns 的 format 使用。
 */
export function toTaipei(s: string): Date {
  return new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

/** Calendar date in Asia/Taipei as YYYY-MM-DD (for date inputs min/max). */
export function taipeiDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

/** Taipei calendar date + N months (for booking max date). */
export function taipeiDatePlusMonths(months: number, from = new Date()): string {
  const tw = toTaipei(from.toISOString());
  tw.setMonth(tw.getMonth() + months);
  return taipeiDateString(tw);
}

/** Group/display key for a reservation start_time in Taipei local date. */
export function reservationDateKey(isoStartTime: string): string {
  const tw = toTaipei(isoStartTime);
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, "0");
  const day = String(tw.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format YYYY-MM-DD date key for display (weekday in zh-TW). */
export function formatReservationDateKey(dateKey: string): string {
  const tw = toTaipei(`${dateKey}T12:00:00+08:00`);
  return tw.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

/** Slot/clock label always in Asia/Taipei (never rely on device/UTC timezone). */
export function formatTaipeiTime(
  iso: string,
  opts?: { hour12?: boolean }
): string {
  const hour12 = opts?.hour12 ?? false;
  // en-GB → stable `HH:mm` (24h) or `hh:mm` when hour12; avoids 上午/下午 on booking grids
  return new Intl.DateTimeFormat(hour12 ? "zh-TW" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
    timeZone: "Asia/Taipei",
  }).format(new Date(iso));
}

/** Taipei calendar date + N days (YYYY-MM-DD). */
export function taipeiDatePlusDays(days: number, from = new Date()): string {
  const tw = toTaipei(from.toISOString());
  tw.setDate(tw.getDate() + days);
  return taipeiDateString(tw);
}
