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
    expect(readTransferText("2026/11/25 6:00", 600, TODAY)?.amountFound).toBe(false);
  });

  it("reads a 民國 year and skips impossible or future dates", () => {
    expect(readTransferText("115/11/25", 600, TODAY)?.date).toBe("2026-11-25");
    expect(readTransferText("2026/13/40 then 2026-11-20", 600, TODAY)?.date).toBe("2026-11-20");
    expect(readTransferText("2026/12/31 NT$600", 600, TODAY)?.date).toBeNull();
  });

  it("ignores mobile numbers, timestamps and over-long serials as accounts", () => {
    expect(readTransferText("0912345678 20261125143207 12345678901234567890 NT$600", 600, TODAY)?.lastFives).toEqual([]);
  });

  it("shows no account when too many candidates make the payer unclear", () => {
    const text = "NT$600 0001112223334 0001112223345 0001112223356 0001112223367";
    expect(readTransferText(text, 600, TODAY)?.lastFives).toEqual([]);
  });

  it("returns null for a picture that is not a transfer", () => {
    expect(readTransferText("Good morning! See you at 3", 600, TODAY)).toBeNull();
    expect(readTransferText("", 600, TODAY)).toBeNull();
  });
});
