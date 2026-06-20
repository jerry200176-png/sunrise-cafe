import { describe, it, expect } from "vitest";
import { computeDepositDeadline, shouldAutoRelease, shouldSendDepositReminder } from "./deposit-deadline";

describe("computeDepositDeadline", () => {
  it("用建立時間 +24h，當訂位時間在更遠的未來", () => {
    const createdAt = "2026-01-01T00:00:00Z";
    const startTime = "2026-01-10T00:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    expect(deadline.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("用訂位開始時間，當訂位在 24 小時內就要開始", () => {
    const createdAt = "2026-01-01T00:00:00Z";
    const startTime = "2026-01-01T10:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    expect(deadline.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });
});

describe("shouldAutoRelease", () => {
  it("超過期限時回傳 true", () => {
    const deadline = new Date("2026-01-01T00:00:00Z");
    expect(shouldAutoRelease(deadline, new Date("2026-01-01T00:00:01Z"))).toBe(true);
  });

  it("未到期限時回傳 false", () => {
    const deadline = new Date("2026-01-01T00:00:00Z");
    expect(shouldAutoRelease(deadline, new Date("2025-12-31T23:59:59Z"))).toBe(false);
  });
});

describe("shouldSendDepositReminder", () => {
  it("已提醒過則不再提醒", () => {
    const deadline = new Date("2026-01-02T00:00:00Z");
    const now = new Date("2026-01-01T12:00:00Z");
    expect(shouldSendDepositReminder(deadline, "2026-01-01T00:00:00Z", now)).toBe(false);
  });

  it("已過期不算提醒（交給 auto-release 處理）", () => {
    const deadline = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-01T00:00:01Z");
    expect(shouldSendDepositReminder(deadline, null, now)).toBe(false);
  });

  it("期限落在提醒視窗內且尚未提醒過時回傳 true", () => {
    const deadline = new Date("2026-01-02T00:00:00Z");
    const now = new Date("2026-01-01T06:00:00Z");
    expect(shouldSendDepositReminder(deadline, null, now)).toBe(true);
  });

  it("期限超出提醒視窗（還太早）時回傳 false", () => {
    const deadline = new Date("2026-01-05T00:00:00Z");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(shouldSendDepositReminder(deadline, null, now)).toBe(false);
  });
});
