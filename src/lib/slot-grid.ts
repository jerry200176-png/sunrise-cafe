/**
 * Half-hour booking grid helpers.
 * Guest availability, book UI, and reschedule must stay aligned.
 */

export const SLOT_STEP_MS = 30 * 60 * 1000; // 30 minutes
export const MIN_DURATION_HOURS = 2;
export const MAX_DURATION_HOURS = 8;

export type GridSlot = {
  start: string;
  end: string;
  available: boolean;
};

/** Duration options shown in booking UI (must match API 2～8h). */
export function getDurationOptions(): number[] {
  const options: number[] = [];
  for (let i = MIN_DURATION_HOURS; i <= MAX_DURATION_HOURS; i += 0.5) {
    options.push(i);
  }
  return options;
}

/** How many 30-min grid cells a duration needs (2.5h → 5). */
export function slotsNeededForDuration(durationHours: number): number {
  if (!Number.isFinite(durationHours) || durationHours <= 0) return 0;
  return Math.round((durationHours * 60) / 30);
}

export function endIsoForDuration(startIso: string, durationHours: number): string {
  return new Date(
    new Date(startIso).getTime() + durationHours * 60 * 60 * 1000
  ).toISOString();
}

/** Exact float hours between two ISO times (e.g. 2.5). */
export function durationHoursBetween(startIso: string, endIso: string): number {
  const h =
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / (60 * 60 * 1000);
  return Math.round(h * 2) / 2; // snap to 0.5 for display/math stability
}

/**
 * True when [start, start+duration) is fully covered by consecutive available
 * half-hour slots (exact occupancy, not Math.ceil whole hours).
 */
export function canSelectStart(
  slots: GridSlot[],
  slotStart: string,
  durationHours: number
): boolean {
  const startIdx = slots.findIndex((s) => s.start === slotStart);
  if (startIdx < 0) return false;
  const needed = slotsNeededForDuration(durationHours);
  if (needed <= 0) return false;
  if (startIdx + needed > slots.length) return false;

  const expectedEnd = endIsoForDuration(slotStart, durationHours);
  for (let i = 0; i < needed; i++) {
    const s = slots[startIdx + i];
    if (!s?.available) return false;
  }
  // Last cell end must match duration end (guards against mismatched grids)
  const last = slots[startIdx + needed - 1];
  return last.end === expectedEnd;
}

export function availableStarts(
  slots: GridSlot[],
  durationHours: number
): { start: string; end: string }[] {
  const options: { start: string; end: string }[] = [];
  for (const s of slots) {
    if (canSelectStart(slots, s.start, durationHours)) {
      options.push({ start: s.start, end: endIsoForDuration(s.start, durationHours) });
    }
  }
  return options;
}

function overlaps(
  slotStart: string,
  slotEnd: string,
  bookStart: string,
  bookEnd: string
): boolean {
  return slotStart < bookEnd && slotEnd > bookStart;
}

/**
 * Build half-hour availability slots for one room on one calendar day (Taipei).
 * `dayStart`/`dayEnd` are ISO instants for open/close that day.
 */
export function buildHalfHourSlots(opts: {
  dayStartIso: string;
  dayEndIso: string;
  blocked: { start_time: string; end_time: string }[];
  isToday: boolean;
  nowMs?: number;
}): GridSlot[] {
  const startMs = new Date(opts.dayStartIso).getTime();
  const endMs = new Date(opts.dayEndIso).getTime();
  const nowMs = opts.isToday ? (opts.nowMs ?? Date.now()) : 0;
  const slots: GridSlot[] = [];

  for (let t = startMs; t + SLOT_STEP_MS <= endMs; t += SLOT_STEP_MS) {
    const slotStart = new Date(t).toISOString();
    const slotEnd = new Date(t + SLOT_STEP_MS).toISOString();
    let available = true;
    if (opts.isToday && slotEndMs(t) <= nowMs) {
      available = false;
    } else if (
      opts.blocked.some((b) => overlaps(slotStart, slotEnd, b.start_time, b.end_time))
    ) {
      available = false;
    }
    slots.push({ start: slotStart, end: slotEnd, available });
  }
  return slots;
}

function slotEndMs(startMs: number) {
  return startMs + SLOT_STEP_MS;
}
