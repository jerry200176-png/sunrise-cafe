import { describe, it, expect } from "vitest";
import {
  getDurationOptions,
  isDepositRequired,
  getDepositAmount,
} from "./booking-utils";

describe("getDepositAmount", () => {
  it("回傳總價一半", () => {
    expect(getDepositAmount(1000)).toBe(500);
  });

  it("奇數總價無條件進位", () => {
    expect(getDepositAmount(999)).toBe(500); // 499.5 → 500
    expect(getDepositAmount(1)).toBe(1); // 0.5 → 1
  });

  it("零元為零", () => {
    expect(getDepositAmount(0)).toBe(0);
  });
});

describe("isDepositRequired", () => {
  it("有日期即需訂金", () => {
    expect(isDepositRequired("2026-06-20")).toBe(true);
  });

  it("空字串不需訂金", () => {
    expect(isDepositRequired("")).toBe(false);
  });
});

describe("getDurationOptions", () => {
  const options = getDurationOptions();

  it("從 2 到 10、間隔 0.5", () => {
    expect(options[0]).toBe(2);
    expect(options[options.length - 1]).toBe(10);
    expect(options).toContain(2.5);
    expect(options).toContain(9.5);
  });

  it("共 17 個選項", () => {
    expect(options).toHaveLength(17); // (10-2)/0.5 + 1
  });
});
