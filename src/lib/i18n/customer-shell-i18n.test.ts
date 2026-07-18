import { describe, it, expect } from "vitest";
import { translations, type Locale } from "./translations";

/** Keys introduced for customer shell / empty-state UX on this branch. */
const REQUIRED_KEYS = [
  "book.stepProgress",
  "book.slot.empty",
  "book.slot.waitlistCtaAlt",
  "query.hintTitle",
  "query.hintDesc",
  "query.emptyBookCta",
  "book.steps.branch",
  "book.steps.date",
  "book.steps.room",
  "book.steps.slot",
  "book.steps.form",
  "common.back",
] as const;

const LOCALES: Locale[] = ["zh-TW", "en", "ja"];

describe("customer shell i18n keys", () => {
  for (const locale of LOCALES) {
    it(`defines required keys for ${locale}`, () => {
      for (const key of REQUIRED_KEYS) {
        const value = translations[locale][key];
        expect(value, `${locale}:${key}`).toBeTruthy();
        expect(value).not.toBe(key);
      }
    });
  }
});
