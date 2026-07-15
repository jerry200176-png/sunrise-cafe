import { describe, it, expect } from "vitest";
import {
  getDurationOptions,
  isDepositRequired,
  getDepositAmount,
  isWeekendDate,
  computeReservationTotalPrice,
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

  it("從 2 到 8、間隔 0.5（與 API 一致）", () => {
    expect(options[0]).toBe(2);
    expect(options[options.length - 1]).toBe(8);
    expect(options).toContain(2.5);
    expect(options).not.toContain(8.5);
    expect(options).not.toContain(10);
  });

  it("共 13 個選項", () => {
    expect(options).toHaveLength(13); // (8-2)/0.5 + 1
  });
});

describe("computeReservationTotalPrice", () => {
  const room = { price_weekday: 200, price_weekend: 300 };

  it("平日 3 小時計價", () => {
    const total = computeReservationTotalPrice(
      room,
      "2026-07-08T10:00:00+08:00",
      "2026-07-08T13:00:00+08:00"
    );
    expect(total).toBe(600);
  });

  it("週末使用假日單價", () => {
    const total = computeReservationTotalPrice(
      room,
      "2026-07-11T10:00:00+08:00",
      "2026-07-11T12:00:00+08:00"
    );
    expect(total).toBe(600);
  });
});

describe("isWeekendDate", () => {
  it("週六為週末", () => {
    expect(isWeekendDate("2026-07-11")).toBe(true);
  });

  it("週三為平日", () => {
    expect(isWeekendDate("2026-07-08")).toBe(false);
  });
});
