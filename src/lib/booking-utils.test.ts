import { afterEach, describe, it, expect, vi } from "vitest";
import {
  getDurationOptions,
  isDepositRequired,
  getDepositAmount,
  isWeekendDate,
  computeReservationTotalPrice,
  taipeiDateForInstant,
} from "./booking-utils";

afterEach(() => vi.unstubAllEnvs());

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

  it.each(["UTC", "Asia/Taipei", "America/Los_Angeles", "Pacific/Kiritimati"])("pure calendar dates do not depend on runtime time zone %s", (zone) => {
    vi.stubEnv("TZ", zone);
    expect(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map(isWeekendDate)).toEqual([false, true, true, false]);
  });

  it("returns false for invalid or incomplete calendar dates", () => {
    for (const date of ["", "bad", "2026-02-30", "2026-11-1"]) expect(isWeekendDate(date)).toBe(false);
  });
});

describe("Taipei price date", () => {
  const room = { price_weekday: 200, price_weekend: 300 };
  it.each(["UTC", "Asia/Taipei", "America/Los_Angeles", "Pacific/Kiritimati"])("uses the same Taipei day for equivalent instants in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    for (const start of ["2026-10-30T17:00:00Z", "2026-10-31T01:00:00+08:00", "2026-10-30T10:00:00-07:00"]) {
      expect(taipeiDateForInstant(start)).toBe("2026-10-31");
      expect(computeReservationTotalPrice(room, start, "2026-10-30T19:00:00Z")).toBe(600);
    }
    expect(taipeiDateForInstant("2026-11-01T17:00:00Z")).toBe("2026-11-02");
    expect(computeReservationTotalPrice(room, "2026-11-01T17:00:00Z", "2026-11-01T19:00:00Z")).toBe(400);
  });

  it("keeps the start day for a stay crossing Taipei midnight", () => {
    expect(computeReservationTotalPrice(room, "2026-10-30T15:00:00Z", "2026-10-30T17:00:00Z")).toBe(400);
  });

  it("returns no Taipei day for an invalid instant", () => {
    expect(taipeiDateForInstant("not-an-instant")).toBeNull();
    expect(computeReservationTotalPrice(room, "not-an-instant", "2026-11-01T19:00:00Z")).toBeNaN();
    expect(() => computeReservationTotalPrice(room, 123 as unknown as string, "2026-11-01T19:00:00Z")).toThrow(TypeError);
  });
});
