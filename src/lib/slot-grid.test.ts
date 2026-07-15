import { describe, it, expect } from "vitest";
import {
  getDurationOptions,
  slotsNeededForDuration,
  canSelectStart,
  availableStarts,
  buildHalfHourSlots,
  endIsoForDuration,
  durationHoursBetween,
  MAX_DURATION_HOURS,
  MIN_DURATION_HOURS,
  SLOT_STEP_MS,
} from "./slot-grid";

describe("getDurationOptions", () => {
  it("2～8 hours step 0.5 (aligned with API)", () => {
    const options = getDurationOptions();
    expect(options[0]).toBe(MIN_DURATION_HOURS);
    expect(options[options.length - 1]).toBe(MAX_DURATION_HOURS);
    expect(options).toContain(2.5);
    expect(options).not.toContain(8.5);
    expect(options).not.toContain(10);
    expect(options).toHaveLength(13); // (8-2)/0.5 + 1
  });
});

describe("slotsNeededForDuration", () => {
  it("maps 2.5h to five 30-min cells", () => {
    expect(slotsNeededForDuration(2)).toBe(4);
    expect(slotsNeededForDuration(2.5)).toBe(5);
    expect(slotsNeededForDuration(3)).toBe(6);
  });
});

describe("buildHalfHourSlots", () => {
  it("generates :00 and :30 starts", () => {
    // 10:00–12:00 Taipei on a fixed day
    const slots = buildHalfHourSlots({
      dayStartIso: "2026-07-17T02:00:00.000Z", // 10:00+08
      dayEndIso: "2026-07-17T04:00:00.000Z", // 12:00+08
      blocked: [],
      isToday: false,
    });
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s.start)).toEqual([
      "2026-07-17T02:00:00.000Z",
      "2026-07-17T02:30:00.000Z",
      "2026-07-17T03:00:00.000Z",
      "2026-07-17T03:30:00.000Z",
    ]);
    expect(slots.every((s) => s.available)).toBe(true);
    expect(SLOT_STEP_MS).toBe(30 * 60 * 1000);
  });

  it("marks overlap with blocked booking unavailable", () => {
    const slots = buildHalfHourSlots({
      dayStartIso: "2026-07-17T02:00:00.000Z",
      dayEndIso: "2026-07-17T05:00:00.000Z",
      blocked: [
        {
          start_time: "2026-07-17T03:00:00.000Z",
          end_time: "2026-07-17T04:00:00.000Z",
        },
      ],
      isToday: false,
    });
    const mid = slots.find((s) => s.start === "2026-07-17T03:00:00.000Z");
    const half = slots.find((s) => s.start === "2026-07-17T03:30:00.000Z");
    const early = slots.find((s) => s.start === "2026-07-17T02:30:00.000Z");
    expect(mid?.available).toBe(false);
    expect(half?.available).toBe(false);
    expect(early?.available).toBe(true);
  });
});

describe("canSelectStart / availableStarts", () => {
  const freeDay = buildHalfHourSlots({
    dayStartIso: "2026-07-17T02:00:00.000Z", // 10:00
    dayEndIso: "2026-07-17T06:00:00.000Z", // 14:00
    blocked: [],
    isToday: false,
  });

  const withHole = buildHalfHourSlots({
    dayStartIso: "2026-07-17T02:00:00.000Z",
    dayEndIso: "2026-07-17T06:00:00.000Z",
    blocked: [
      {
        start_time: "2026-07-17T04:00:00.000Z", // 12:00–12:30
        end_time: "2026-07-17T04:30:00.000Z",
      },
    ],
    isToday: false,
  });

  it("allows half-hour starts like 10:30 (and 13:30-style)", () => {
    expect(canSelectStart(freeDay, "2026-07-17T02:30:00.000Z", 2)).toBe(true);
    expect(canSelectStart(freeDay, "2026-07-17T05:30:00.000Z", 2)).toBe(false); // not enough day left
  });

  it("2.5h from 10:00 fails when 12:00–12:30 blocked", () => {
    expect(canSelectStart(withHole, "2026-07-17T02:00:00.000Z", 2.5)).toBe(false);
  });

  it("2h from 10:00 still ok (ends 12:00, no need of blocked cell)", () => {
    expect(canSelectStart(withHole, "2026-07-17T02:00:00.000Z", 2)).toBe(true);
    expect(endIsoForDuration("2026-07-17T02:00:00.000Z", 2)).toBe(
      "2026-07-17T04:00:00.000Z"
    );
  });

  it("availableStarts returns exact end for duration", () => {
    const opts = availableStarts(freeDay, 2);
    const hit = opts.find((o) => o.start === "2026-07-17T02:30:00.000Z");
    expect(hit?.end).toBe("2026-07-17T04:30:00.000Z");
  });
});

describe("durationHoursBetween", () => {
  it("preserves half hours", () => {
    expect(
      durationHoursBetween(
        "2026-07-17T05:30:00.000Z",
        "2026-07-17T08:00:00.000Z"
      )
    ).toBe(2.5);
  });
});
