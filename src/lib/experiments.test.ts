import { describe, expect, it } from "vitest";
import {
  assignVariant,
  isExperimentActive,
  parseVariants,
} from "./experiments";

describe("experiments", () => {
  it("parses variants array", () => {
    expect(parseVariants(["a", "b"])).toEqual(["a", "b"]);
    expect(parseVariants(null)).toEqual(["control", "treatment"]);
  });

  it("checks active window", () => {
    const exp = {
      id: "1",
      key: "test",
      name: "Test",
      description: null,
      target_audience: "all",
      status: "running" as const,
      variants: ["control", "treatment"],
      start_at: null,
      end_at: null,
    };
    expect(isExperimentActive(exp)).toBe(true);
  });

  it("assigns deterministic variant", () => {
    const a = assignVariant("landing_cta", "sess-abc", ["control", "treatment"]);
    const b = assignVariant("landing_cta", "sess-abc", ["control", "treatment"]);
    expect(a).toBe(b);
  });
});
