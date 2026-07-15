import { describe, it, expect } from "vitest";
import {
  toTaipei,
  taipeiDateString,
  reservationDateKey,
  formatTaipeiTime,
  taipeiDatePlusDays,
} from "./datetime";

/**
 * toTaipei 把 UTC 瞬間轉成台灣（UTC+8）牆上時間。
 * 回傳的 Date 以本機時區讀取（getHours 等），其數值即等於台灣當地時間，
 * 故以下斷言不受測試機器時區影響。
 */
describe("toTaipei", () => {
  it("UTC 午夜 → 台灣早上 8 點", () => {
    const d = toTaipei("2026-06-20T00:00:00Z");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 6 月（0-indexed）
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(8);
  });

  it("跨日：UTC 20:00 → 台灣隔日凌晨 4 點", () => {
    const d = toTaipei("2026-06-19T20:00:00Z");
    expect(d.getDate()).toBe(20); // 進到隔天
    expect(d.getHours()).toBe(4);
  });

  it("午夜邊界：UTC 16:00 → 台灣隔日 00:00", () => {
    const d = toTaipei("2026-06-19T16:00:00Z");
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(0);
  });
});

describe("taipeiDateString", () => {
  it("returns YYYY-MM-DD in Taipei", () => {
    const s = taipeiDateString(new Date("2026-06-19T20:00:00Z"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s).toBe("2026-06-20");
  });
});

describe("reservationDateKey", () => {
  it("uses Taipei local date not UTC slice", () => {
    expect(reservationDateKey("2026-06-19T20:00:00Z")).toBe("2026-06-20");
  });
});

describe("formatTaipeiTime", () => {
  it("formats UTC morning as Taipei local 10:00 in 24h", () => {
    // 02:00Z = 10:00 Asia/Taipei
    const label = formatTaipeiTime("2026-07-17T02:00:00.000Z");
    expect(label).toMatch(/10:00/);
    expect(label).not.toMatch(/02:00/);
  });

  it("formats half-hour starts", () => {
    expect(formatTaipeiTime("2026-07-17T05:30:00.000Z")).toMatch(/13:30/);
  });
});

describe("taipeiDatePlusDays", () => {
  it("adds days in Taipei calendar", () => {
    expect(taipeiDatePlusDays(1, new Date("2026-06-19T20:00:00Z"))).toBe("2026-06-21");
  });
});
