import { describe, expect, it } from "vitest";
import { readTransferText } from "./transfer-text";

const TODAY = "2026-11-26";

describe("readTransferText", () => {
  it("reads amount, date and the account last five from a typical transfer screen", () => {
    const text = "Transfer successful\n2026/11/25 14:32:07\nTo 012-345-678901\nFrom ****54321\nNT$ 600\nFee 0";
    expect(readTransferText(text, 600, TODAY)).toEqual({ amountFound: true, date: "2026-11-25", lastFives: ["78901", "54321"] });
  });

  it("accepts thousands separators, .00 and a minus sign in front of the amount", () => {
    expect(readTransferText("TWD -1,200.00", 1200, TODAY)?.amountFound).toBe(true);
    expect(readTransferText("１２００元", 1200, TODAY)?.amountFound).toBe(true);
  });

  it("does not find the amount inside a longer number, an account, a time or another amount", () => {
    expect(readTransferText("NT$ 1600  2026/11/25", 600, TODAY)?.amountFound).toBe(false);
    expect(readTransferText("NT$ 6000  2026/11/25", 600, TODAY)?.amountFound).toBe(false);
    expect(readTransferText("NT$ 600.50  2026/11/25", 600, TODAY)?.amountFound).toBe(false);
    expect(readTransferText("012-600-123456", 600, TODAY)?.amountFound).toBe(false);
    expect(readTransferText("2026/11/25 600:15", 600, TODAY)?.amountFound).toBe(false);
    expect(readTransferText("2026/11/25 ref.600", 600, TODAY)?.amountFound).toBe(false);
  });

  it("reads a 民國 year and skips impossible or future dates", () => {
    expect(readTransferText("115/11/25", 600, TODAY)?.date).toBe("2026-11-25");
    expect(readTransferText("2026/13/40 then 2026-11-20", 600, TODAY)?.date).toBe("2026-11-20");
    expect(readTransferText("2026/12/31 NT$600", 600, TODAY)?.date).toBeNull();
  });

  it("ignores mobile numbers, timestamps and over-long serials as accounts", () => {
    expect(readTransferText("NT$600\n0912345678", 600, TODAY)?.lastFives).toEqual([]);
    expect(readTransferText("NT$600\n20261125143207", 600, TODAY)?.lastFives).toEqual([]);
    expect(readTransferText("NT$600\n12345678901234567890", 600, TODAY)?.lastFives).toEqual([]);
  });

  it("never glues two numbers separated by a space into one account", () => {
    expect(readTransferText("012-345-678901 600", 600, TODAY)).toMatchObject({ amountFound: true, lastFives: ["78901"] });
    expect(readTransferText("NT$600 78901 54321 12345", 600, TODAY)?.lastFives).toEqual([]);
    expect(readTransferText("NT$600 0000 1234 5675 4321", 600, TODAY)?.lastFives).toEqual(["54321"]);
  });

  it("shows no account when too many candidates make the payer unclear", () => {
    const text = "NT$600 0001112223334 0001112223345 0001112223356 0001112223367";
    expect(readTransferText(text, 600, TODAY)?.lastFives).toEqual([]);
  });

  it("reads real OCR output (English model on Chinese bank screens, labels come out as noise)", () => {
    const light = "BRAS\nR55 Hf\nBH RSE\nNTS 600\n2026/11/25 14:32:07\n(822) 0000-1234-5675-4321\n808 ELLFRTT\n0123-456-789012\nNTS 0\n2B";
    expect(readTransferText(light, 600, TODAY)).toEqual({ amountFound: true, date: "2026-11-25", lastFives: ["54321", "89012"] });
    const dark = "FERRI\n-$1,200\n115/11/24 09:05\nEBA EttEE 78901\nHH mAIRA **r**54321\nRHEE 20261124090512345678\nB] FIEREE $35,420";
    expect(readTransferText(dark, 1200, TODAY)).toEqual({ amountFound: true, date: "2026-11-24", lastFives: ["54321"] });
  });

  it("returns null for a picture that is not a transfer", () => {
    expect(readTransferText("Good morning! See you at 3", 600, TODAY)).toBeNull();
    expect(readTransferText("", 600, TODAY)).toBeNull();
  });
});
