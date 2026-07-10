import { describe, it, expect } from "vitest";
import { normalizePhone, phonesMatch } from "./phone-utils";

describe("normalizePhone", () => {
  it("normalizes Taiwan mobile", () => {
    expect(normalizePhone("0912345678")).toBe("0912345678");
  });

  it("handles international prefix", () => {
    expect(normalizePhone("886912345678")).toBe("0912345678");
  });
});

describe("phonesMatch", () => {
  it("matches formatted vs plain", () => {
    expect(phonesMatch("0912-345-678", "0912345678")).toBe(true);
  });

  it("matches +886 vs 09", () => {
    expect(phonesMatch("+886912345678", "0912345678")).toBe(true);
  });

  it("rejects different numbers", () => {
    expect(phonesMatch("0912345678", "0987654321")).toBe(false);
  });
});
