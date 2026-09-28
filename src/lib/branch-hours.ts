/** Per-weekday opening hours stored in branches.weekly_hours. */
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];
export type DayHours = { open: string; close: string };
/** null day = closed; missing day = branch open_time/close_time. */
export type WeeklyHours = Partial<Record<WeekdayKey, DayHours | null>>;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Weekday of a YYYY-MM-DD calendar date in Taiwan. */
export function weekdayKeyForDate(date: string): WeekdayKey {
  return WEEKDAY_KEYS[new Date(`${date}T12:00:00+08:00`).getUTCDay()];
}

/**
 * Opening hours on `date`, or null when the branch is closed that weekday.
 * Without weekly_hours (or for a weekday it doesn't list) the branch-wide times apply.
 */
export function hoursForDate(
  branch: { open_time?: string | null; close_time?: string | null; weekly_hours?: WeeklyHours | null },
  date: string
): { open: string | null; close: string | null } | null {
  const fallback = { open: branch.open_time ?? null, close: branch.close_time ?? null };
  const weekly = branch.weekly_hours;
  if (!weekly || typeof weekly !== "object") return fallback;
  const key = weekdayKeyForDate(date);
  if (!(key in weekly)) return fallback;
  const day = weekly[key];
  return day ? { open: day.open, close: day.close } : null;
}

/** Admin input check: every listed day is null (closed) or has valid HH:MM open < close. */
export function validateWeeklyHours(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "每週營業時間格式不正確";
  for (const [key, day] of Object.entries(value as Record<string, unknown>)) {
    if (!(WEEKDAY_KEYS as readonly string[]).includes(key)) return `未知的星期：${key}`;
    if (day === null) continue;
    const d = day as Partial<DayHours>;
    if (typeof d.open !== "string" || typeof d.close !== "string" || !HM.test(d.open) || !HM.test(d.close)) {
      return `${key} 的時間格式須為 HH:MM`;
    }
    if (d.open >= d.close) return `${key} 的開始時間必須早於結束時間`;
  }
  return null;
}

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "週一", tue: "週二", wed: "週三", thu: "週四", fri: "週五", sat: "週六", sun: "週日",
};
/** Admin display order, Monday first. */
export const ADMIN_WEEK_ORDER: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type WeekdayFormRow = { key: WeekdayKey; closed: boolean; open: string; close: string };

export function weeklyToFormRows(weekly: WeeklyHours | null | undefined, open: string, close: string): WeekdayFormRow[] {
  return ADMIN_WEEK_ORDER.map((key) => {
    const day = weekly && key in weekly ? weekly[key] : { open, close };
    return day ? { key, closed: false, open: day.open, close: day.close } : { key, closed: true, open, close };
  });
}

export function formRowsToWeekly(rows: WeekdayFormRow[]): WeeklyHours {
  return Object.fromEntries(rows.map((r) => [r.key, r.closed ? null : { open: r.open, close: r.close }]));
}
