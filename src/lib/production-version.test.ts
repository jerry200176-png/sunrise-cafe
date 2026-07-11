import { describe, it, expect } from "vitest";
import { deploymentShaParity } from "./production-version";

describe("deploymentShaParity", () => {
  it("returns true when SHAs match", () => {
    expect(deploymentShaParity("abc1234", "abc1234")).toBe(true);
  });

  it("returns false when SHAs differ", () => {
    expect(deploymentShaParity("de01dba", "f083d10")).toBe(false);
  });

  it("returns null when either missing", () => {
    expect(deploymentShaParity(null, "abc1234")).toBeNull();
  });
});
