import { describe, expect, it } from "vitest";
import { translations, type Locale } from "./translations";

describe("deposit policy wording", () => {
  it.each([
    ["zh-TW", "不會自動取消", "不會因此自動取消"],
    ["en", "not be automatically cancelled", "not be automatically cancelled"],
    ["ja", "自動キャンセルされません", "自動キャンセルされません"],
  ] as const)("explains retained bookings in %s", (locale: Locale, success, query) => {
    expect(translations[locale]["success.depositDeadlineBody"]).toContain(success);
    expect(translations[locale]["query.depositDeadlinePast"]).toContain(query);
  });
});
