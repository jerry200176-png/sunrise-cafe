import { describe, expect, it } from "vitest";
import { calcConversionRate } from "@/lib/outcome-metrics";

describe("ops-metrics ratios", () => {
  it("booking conversion from counts", () => {
    expect(calcConversionRate(8, 10)).toBe(80);
    expect(calcConversionRate(0, 0)).toBeNull();
  });
});
