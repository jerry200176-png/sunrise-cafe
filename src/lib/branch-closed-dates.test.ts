import { describe, expect, it } from "vitest";
import { isDateClosed, resolveClosedDates } from "./branch-closed-dates";

describe("branch-closed-dates", () => {
  it("prefers branch closed dates when set", () => {
    expect(resolveClosedDates(["2026-07-15"], ["2026-07-01"])).toEqual(["2026-07-15"]);
  });

  it("falls back to global when branch empty", () => {
    expect(resolveClosedDates([], ["2026-07-01"])).toEqual(["2026-07-01"]);
    expect(resolveClosedDates(null, ["2026-07-01"])).toEqual(["2026-07-01"]);
  });

  it("isDateClosed checks membership", () => {
    expect(isDateClosed("2026-07-01", ["2026-07-01"])).toBe(true);
    expect(isDateClosed("2026-07-02", ["2026-07-01"])).toBe(false);
  });
});
