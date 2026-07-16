import { describe, expect, it } from "vitest";
import { taipeiDayUtcBounds } from "./job-runs";

describe("taipeiDayUtcBounds", () => {
  it("uses Asia/Taipei calendar day", () => {
    // 2026-07-16 20:30 TW = 12:30 UTC
    const { date, startIso, endIso } = taipeiDayUtcBounds(
      new Date("2026-07-16T12:30:00.000Z")
    );
    expect(date).toBe("2026-07-16");
    expect(startIso).toBe(new Date("2026-07-16T00:00:00+08:00").toISOString());
    expect(endIso).toBe(new Date("2026-07-16T23:59:59.999+08:00").toISOString());
  });

  it("rolls date after midnight Taipei", () => {
    // 2026-07-16 23:30 UTC = 2026-07-17 07:30 TW
    const { date } = taipeiDayUtcBounds(new Date("2026-07-16T23:30:00.000Z"));
    expect(date).toBe("2026-07-17");
  });
});
