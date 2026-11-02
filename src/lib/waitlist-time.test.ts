import { describe, expect, it } from "vitest";
import { formatWaitlistRange } from "./waitlist-time";

describe("waitlist display time", () => {
  it("uses the Taipei calendar date and clock time across midnight UTC", () => {
    const result = formatWaitlistRange("2026-10-31T16:30:00Z", "2026-10-31T18:30:00Z", "zh-TW");
    expect(result).toContain("11/1");
    expect(result).toContain("00:30–02:30");
  });
});
