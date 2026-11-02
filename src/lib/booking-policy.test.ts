import { describe, expect, it } from "vitest";
import { DEFAULT_BOOKING_POLICY, formatBookingPolicyLines } from "./booking-policy";
import { translations } from "./i18n/translations";

describe("guest cancellation disclosures", () => {
  it("keeps the default and Traditional Chinese booking copy aligned", () => {
    expect(translations["zh-TW"]["book.form.cancelPolicy"]).toBe(DEFAULT_BOOKING_POLICY.cancelRule);
  });

  it.each(["zh-TW", "en", "ja"] as const)("includes the contact and timing information in %s", (locale) => {
    const copy = translations[locale]["book.form.cancelPolicy"];
    const paidCopy = translations[locale]["query.cancelPaidContactStore"];
    expect(copy).toContain("24");
    expect(copy).toContain("48");
    expect(copy).toContain("LINE");
    expect(paidCopy).toContain("48");
    expect(paidCopy).toContain("LINE");
    expect(formatBookingPolicyLines(undefined, copy)).toContain(`・${copy}`);
  });
});
