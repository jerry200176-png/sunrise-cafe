import { describe, expect, it } from "vitest";
import { recommendSlotStarts, rankDatesByAvailability } from "./slot-recommendations";

function slotsForDay(startHour: number, count: number, blockedHour?: number) {
  const slots = [];
  for (let h = startHour; h < startHour + count; h++) {
    slots.push({
      start: `2026-08-15T${String(h).padStart(2, "0")}:00:00+08:00`,
      end: `2026-08-15T${String(h + 1).padStart(2, "0")}:00:00+08:00`,
      available: h !== blockedHour,
    });
  }
  return slots;
}

describe("recommendSlotStarts", () => {
  it("returns contiguous available starts", () => {
    const slots = slotsForDay(10, 6, 12);
    const rec = recommendSlotStarts(slots, 2, 2);
    expect(rec.length).toBe(2);
    expect(rec[0]).toContain("T10:00:00");
  });

  it("returns empty when no window fits duration", () => {
    expect(recommendSlotStarts(slotsForDay(10, 2, 10), 3)).toEqual([]);
  });
});

describe("rankDatesByAvailability", () => {
  it("ranks dates by window count", () => {
    const ranked = rankDatesByAvailability(
      [
        { date: "2026-08-15", slots: slotsForDay(10, 5) },
        { date: "2026-08-16", slots: slotsForDay(10, 3) },
      ],
      2
    );
    expect(ranked[0].date).toBe("2026-08-15");
    expect(ranked[0].available_windows).toBeGreaterThan(ranked[1].available_windows);
  });
});
