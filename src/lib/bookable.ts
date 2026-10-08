/**
 * Bookable slot: the one place that answers "can this room be booked from
 * start to end, and if not, why?" (ADR-010 keeps the DB exclusion constraint
 * as the last line of defence for concurrent writes).
 *
 * The availability grid derives its open/closed day and its slot window from
 * `resolveDay`, the same function `checkBookable` uses, so the grid and the
 * write paths cannot disagree about closed dates and opening hours.
 */
import { reservationDateKey } from "@/lib/datetime";
import { isDateClosed, resolveClosedDates } from "@/lib/branch-closed-dates";
import { hoursForDate, type WeeklyHours } from "@/lib/branch-hours";
import { MAX_DURATION_HOURS, MIN_DURATION_HOURS, SLOT_STEP_MS } from "@/lib/slot-grid";
import { fetchBranch, fetchRoom, hasSlotConflict } from "@/lib/supabase-admin";
import { fetchSettings } from "@/lib/supabase-fetch";

const DEFAULT_OPEN = { h: 8, m: 0 };
const DEFAULT_CLOSE = { h: 22, m: 0 };
const TAIWAN_OFFSET = "+08:00";

export type BookableActor = "guest" | "admin";

export type BookableReason =
  | "invalid_time"
  | "too_short"
  | "too_long"
  | "in_past"
  | "closed_date"
  | "outside_hours"
  | "conflict";

export type BookableResult = { ok: true } | { ok: false; reason: BookableReason };

export type BranchSchedule = {
  open_time?: string | null;
  close_time?: string | null;
  weekly_hours?: WeeklyHours | null;
  closed_dates?: string[] | null;
};

export type Day =
  | { closed: true }
  | { closed: false; open: string | null; close: string | null; startIso: string; endIso: string };

function parseTime(t: string | null | undefined, fallback: { h: number; m: number }) {
  if (!t) return fallback;
  const [h, m] = String(t).split(":").map(Number);
  return { h: Number.isFinite(h) ? h : fallback.h, m: Number.isFinite(m) ? m : fallback.m };
}

/** Open/closed state and the [open, close) window of one Taipei calendar date. */
export function resolveDay(
  branch: BranchSchedule | null | undefined,
  globalClosedDates: string[] | null | undefined,
  date: string
): Day {
  if (isDateClosed(date, resolveClosedDates(branch?.closed_dates, globalClosedDates))) {
    return { closed: true };
  }
  const hours = branch ? hoursForDate(branch, date) : undefined;
  if (hours === null) return { closed: true }; // weekday marked closed
  const open = hours?.open ?? branch?.open_time ?? null;
  const close = hours?.close ?? branch?.close_time ?? null;
  const o = parseTime(open, DEFAULT_OPEN);
  const c = parseTime(close, DEFAULT_CLOSE);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = new Date(`${date}T${pad(o.h)}:${pad(o.m)}:00${TAIWAN_OFFSET}`);
  const end = new Date(`${date}T${pad(c.h)}:${pad(c.m)}:00${TAIWAN_OFFSET}`);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return { closed: false, open, close, startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Pure rules. `admin` may book outside opening hours / closed dates / the past
 * (staff override); duration and conflict apply to everyone.
 */
export function evaluateBookable(input: {
  start: string;
  end: string;
  day: (date: string) => Day;
  conflict: boolean;
  actor: BookableActor;
  nowMs?: number;
}): BookableResult {
  const startMs = new Date(input.start).getTime();
  const endMs = new Date(input.end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, reason: "invalid_time" };
  }
  const hours = (endMs - startMs) / 3_600_000;
  if (hours < MIN_DURATION_HOURS) return { ok: false, reason: "too_short" };
  if (hours > MAX_DURATION_HOURS) return { ok: false, reason: "too_long" };

  if (input.actor === "guest") {
    // Same cut-off as the grid: a slot whose end has passed is not offered.
    if (startMs + SLOT_STEP_MS <= (input.nowMs ?? Date.now())) return { ok: false, reason: "in_past" };
    const day = input.day(reservationDateKey(input.start));
    if (day.closed) return { ok: false, reason: "closed_date" };
    if (startMs < new Date(day.startIso).getTime() || endMs > new Date(day.endIso).getTime()) {
      return { ok: false, reason: "outside_hours" };
    }
  }
  if (input.conflict) return { ok: false, reason: "conflict" };
  return { ok: true };
}

export const BOOKABLE_HTTP: Record<BookableReason, { status: number; error: string }> = {
  invalid_time: { status: 400, error: "結束時間必須晚於開始時間" },
  too_short: { status: 400, error: "包廂最少需預約 2 小時" },
  too_long: { status: 400, error: "單次預約時長不得超過 8 小時" },
  in_past: { status: 400, error: "此時段已過，請重新選擇" },
  closed_date: { status: 400, error: "該日期公休，無法預約" },
  outside_hours: { status: 400, error: "預約時間須在營業時間內" },
  conflict: { status: 409, error: "該時段已被預訂，請重新選擇" },
};

/** Seam for tests: where the facts about a room come from. */
export type BookableDeps = {
  roomBranchId(roomId: string): Promise<string | null>;
  branch(branchId: string): Promise<BranchSchedule | null>;
  globalClosedDates(): Promise<string[]>;
  hasConflict(roomId: string, start: string, end: string, excludeId?: string): Promise<boolean>;
};

const supabaseDeps: BookableDeps = {
  roomBranchId: async (id) => (await fetchRoom(id))?.branch_id ?? null,
  branch: async (id) => (await fetchBranch(id)) as BranchSchedule | null,
  globalClosedDates: async () => (await fetchSettings()).closed_dates,
  hasConflict: async (r, s, e, x) => Boolean(await hasSlotConflict(r, s, e, x)),
};

export async function checkBookable(
  roomId: string,
  start: string,
  end: string,
  opts: {
    actor: BookableActor;
    excludeId?: string;
    /** false when an atomic RPC owns conflict detection (idempotent retries). */
    checkConflict?: boolean;
    deps?: BookableDeps;
    nowMs?: number;
  }
): Promise<BookableResult> {
  const deps = opts.deps ?? supabaseDeps;
  let branch: BranchSchedule | null = null;
  let globalClosed: string[] = [];
  if (opts.actor === "guest") {
    const branchId = await deps.roomBranchId(roomId);
    [branch, globalClosed] = await Promise.all([
      branchId ? deps.branch(branchId) : Promise.resolve(null),
      deps.globalClosedDates(),
    ]);
  }
  const conflict =
    opts.checkConflict === false ? false : await deps.hasConflict(roomId, start, end, opts.excludeId);
  return evaluateBookable({
    start,
    end,
    conflict,
    actor: opts.actor,
    nowMs: opts.nowMs,
    day: (date) => resolveDay(branch, globalClosed, date),
  });
}
