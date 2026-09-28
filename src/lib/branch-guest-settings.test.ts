import { describe, it, expect } from "vitest";
import { formatRentalNotesText, parseRentalNotesText, resolveBranchGuestSettings } from "./branch-guest-settings";

const shared = {
  rental_notes: [{ title: "共用規則", items: ["準時入場"] }],
  deposit_info: "共用訂金說明",
  google_review_url: "https://g.page/shared",
};

describe("resolveBranchGuestSettings", () => {
  it("uses the branch's own values when filled in", () => {
    const own = {
      rental_notes: [{ title: "信義店規則", items: ["禁止外食"] }],
      deposit_info: "信義店訂金說明",
      google_review_url: "https://g.page/xinyi",
    };
    expect(resolveBranchGuestSettings(own, shared)).toEqual(own);
  });

  it("falls back to the shared settings for empty, blank or missing branch values", () => {
    for (const branch of [undefined, null, {}, { rental_notes: [], deposit_info: "  ", google_review_url: "" }, { rental_notes: null, deposit_info: null, google_review_url: null }]) {
      expect(resolveBranchGuestSettings(branch, shared)).toEqual(shared);
    }
  });

  it("returns null review link when neither branch nor shared settings have one", () => {
    expect(resolveBranchGuestSettings(null, { rental_notes: [], deposit_info: null }).google_review_url).toBeNull();
  });
});

describe("rental notes textarea format", () => {
  it("round-trips sections, trimming blank lines and spaces", () => {
    const text = "  入場規則 \n請準時入場\n\n\n取消規則\n 前 24 小時可取消 \n";
    const parsed = parseRentalNotesText(text);
    expect(parsed).toEqual([
      { title: "入場規則", items: ["請準時入場"] },
      { title: "取消規則", items: ["前 24 小時可取消"] },
    ]);
    expect(parseRentalNotesText(formatRentalNotesText(parsed))).toEqual(parsed);
  });

  it("treats empty text as 'use shared notes'", () => {
    expect(parseRentalNotesText(" \n \n")).toBeNull();
    expect(formatRentalNotesText(null)).toBe("");
  });
});
