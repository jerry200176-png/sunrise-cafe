import { describe, it, expect } from "vitest";
import { toTaipei } from "./datetime";

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
