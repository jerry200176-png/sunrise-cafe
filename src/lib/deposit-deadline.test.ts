import { describe, it, expect } from "vitest";
import {
  computeDepositDeadline,
  shouldAutoRelease,
  shouldSendDepositReminder,
  shouldSendUrgentDepositReminder,
  getDepositUrgency,
  formatDepositDeadlineLabel,
} from "./deposit-deadline";

describe("computeDepositDeadline", () => {
  it("提前多天訂位時，期限落在訂位開始前 6 小時（而非建立後 24 小時就要繳）", () => {
    // 舊制在此案例會算出「建立時間+24h」= 訂位前 8 天就要繳訂金，太早太狠。
    const createdAt = "2026-01-01T00:00:00Z";
    const startTime = "2026-01-10T00:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    expect(deadline.toISOString()).toBe("2026-01-09T18:00:00.000Z");
  });

  it("提前 5 天訂位時，客人幾乎有整整 5 天可以繳（不會被壓成隔天就到期）", () => {
    const createdAt = "2026-01-01T00:00:00Z";
    const startTime = "2026-01-06T00:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    expect(deadline.toISOString()).toBe("2026-01-05T18:00:00.000Z");
  });

  it("用訂位開始時間封頂，當訂位在很短時間內就要開始（臨時訂位）", () => {
    const createdAt = "2026-01-01T00:00:00Z";
    const startTime = "2026-01-01T10:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    expect(deadline.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  it("邊界：訂位在建立後恰好 48 小時開始，期限等於訂位開始時間", () => {
    const createdAt = "2026-01-01T00:00:00Z";
    const startTime = "2026-01-03T00:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    expect(deadline.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });

  it("期限永遠不早於訂位開始前 6 小時，也永遠不晚於訂位開始時間本身", () => {
    const cases: Array<[string, string]> = [
      ["2026-01-01T00:00:00Z", "2026-01-01T00:30:00Z"], // 訂位後 30 分鐘就要開始
      ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"], // 一個月後才要開始
    ];
    for (const [createdAt, startTime] of cases) {
      const deadline = computeDepositDeadline(createdAt, startTime).getTime();
      const startMs = new Date(startTime).getTime();
      expect(deadline).toBeLessThanOrEqual(startMs);
      expect(deadline).toBeGreaterThanOrEqual(startMs - 6 * 60 * 60 * 1000);
    }
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

describe("shouldSendUrgentDepositReminder", () => {
  it("requires first reminder already sent", () => {
    const deadline = new Date("2026-01-01T06:00:00Z");
    const now = new Date("2026-01-01T01:00:00Z");
    expect(shouldSendUrgentDepositReminder(deadline, null, null, now)).toBe(false);
  });

  it("skips when urgent already sent", () => {
    const deadline = new Date("2026-01-01T06:00:00Z");
    const now = new Date("2026-01-01T01:00:00Z");
    expect(
      shouldSendUrgentDepositReminder(
        deadline,
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:30:00Z",
        now
      )
    ).toBe(false);
  });

  it("sends when soon and first reminder done", () => {
    const deadline = new Date("2026-01-01T06:00:00Z");
    const now = new Date("2026-01-01T01:00:00Z");
    expect(
      shouldSendUrgentDepositReminder(deadline, "2026-01-01T00:00:00Z", null, now)
    ).toBe(true);
  });

  it("does not send when more than 6h remain", () => {
    const deadline = new Date("2026-01-02T00:00:00Z");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(
      shouldSendUrgentDepositReminder(deadline, "2025-12-31T12:00:00Z", null, now)
    ).toBe(false);
  });
});

describe("getDepositUrgency", () => {
  it("past when deadline elapsed", () => {
    const deadline = new Date("2026-01-01T00:00:00Z");
    expect(getDepositUrgency(deadline, new Date("2026-01-01T00:00:01Z"))).toBe("past");
  });

  it("soon within 6 hours", () => {
    const deadline = new Date("2026-01-01T06:00:00Z");
    expect(getDepositUrgency(deadline, new Date("2026-01-01T01:00:00Z"))).toBe("soon");
  });

  it("ok when more than 6 hours remain", () => {
    const deadline = new Date("2026-01-02T00:00:00Z");
    expect(getDepositUrgency(deadline, new Date("2026-01-01T00:00:00Z"))).toBe("ok");
  });
});

describe("formatDepositDeadlineLabel", () => {
  it("formats Taipei wall clock", () => {
    const label = formatDepositDeadlineLabel(new Date("2026-06-19T16:00:00Z"));
    expect(label).toMatch(/2026\/06\/20/);
    expect(label).toMatch(/00:00/);
  });
});
