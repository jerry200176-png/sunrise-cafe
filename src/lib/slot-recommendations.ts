/**
 * Suggest alternate booking slots when demand is tight.
 * Heuristic only — never hides availability or creates false urgency.
 */

export type SlotOption = {
  start: string;
  end: string;
  available: boolean;
};

/** Top N contiguous-available start times for the given duration */
export function recommendSlotStarts(
  slots: SlotOption[],
  durationHours: number,
  limit = 3
): string[] {
  if (slots.length === 0 || durationHours <= 0) return [];

  const slotsNeeded = Math.ceil(durationHours);
  const starts: string[] = [];

  for (let i = 0; i + slotsNeeded <= slots.length; i++) {
    const window = slots.slice(i, i + slotsNeeded);
    if (!window.every((s) => s.available)) continue;
    starts.push(window[0].start);
    if (starts.length >= limit) break;
  }

  return starts;
}

/** Score days by count of available contiguous windows (for waitlist/book hints) */
export function rankDatesByAvailability(
  dateSlots: { date: string; slots: SlotOption[] }[],
  durationHours: number,
  limit = 3
): { date: string; available_windows: number }[] {
  const slotsNeeded = Math.ceil(durationHours);
  return dateSlots
    .map(({ date, slots }) => {
      let windows = 0;
      for (let i = 0; i + slotsNeeded <= slots.length; i++) {
        const window = slots.slice(i, i + slotsNeeded);
        if (window.every((s) => s.available)) windows += 1;
      }
      return { date, available_windows: windows };
    })
    .filter((d) => d.available_windows > 0)
    .sort((a, b) => b.available_windows - a.available_windows)
    .slice(0, limit);
}
