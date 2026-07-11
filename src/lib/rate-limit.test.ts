import { describe, it, expect } from "vitest";
import { guestRateLimitId } from "./rate-limit";

describe("guestRateLimitId", () => {
  it("without phone uses IP only", () => {
    expect(guestRateLimitId("1.2.3.4", null)).toBe("ip:1.2.3.4");
  });

  it("with phone includes stable hash", () => {
    const a = guestRateLimitId("1.2.3.4", "0912345678");
    const b = guestRateLimitId("1.2.3.4", "0912-345-678");
    expect(a).toBe(b);
    expect(a).toMatch(/^ip:1\.2\.3\.4:ph:[a-f0-9]{16}$/);
  });

  it("different phones produce different keys", () => {
    const a = guestRateLimitId("1.2.3.4", "0912345678");
    const b = guestRateLimitId("1.2.3.4", "0987654321");
    expect(a).not.toBe(b);
  });
});
