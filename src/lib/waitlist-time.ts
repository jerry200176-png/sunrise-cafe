import { formatTaipeiTime } from "@/lib/datetime";

/** Waitlist times describe the shop's local time, regardless of the guest's device timezone. */
export function formatWaitlistRange(startIso: string, endIso: string, locale: "zh-TW" | "en" | "ja") {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(new Date(startIso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}/${value("day")} (${value("weekday")}) ${formatTaipeiTime(startIso)}–${formatTaipeiTime(endIso)}`;
}
