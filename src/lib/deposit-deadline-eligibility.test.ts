import { describe, it, expect } from "vitest";
import {
  isEligibleForDepositDeadline,
  DEPOSIT_DEADLINE_STATUSES,
} from "./deposit-deadline-eligibility";
import {
  computeDepositDeadline,
  shouldAutoRelease,
  shouldSendDepositReminder,
} from "./deposit-deadline";

describe("isEligibleForDepositDeadline", () => {
  it("pending + unpaid → eligible", () => {
    expect(isEligibleForDepositDeadline("pending", false)).toBe(true);
  });

  it("confirmed + unpaid → eligible（主要修復情境）", () => {
    expect(isEligibleForDepositDeadline("confirmed", false)).toBe(true);
  });

  it("confirmed + paid → not eligible", () => {
    expect(isEligibleForDepositDeadline("confirmed", true)).toBe(false);
  });

  it("pending + paid → not eligible", () => {
    expect(isEligibleForDepositDeadline("pending", true)).toBe(false);
  });

  it("cancelled + unpaid → not eligible", () => {
    expect(isEligibleForDepositDeadline("cancelled", false)).toBe(false);
  });

  it("checked_in + unpaid → not eligible（已到店，不應自動釋放）", () => {
    expect(isEligibleForDepositDeadline("checked_in", false)).toBe(false);
  });

  it("completed + unpaid → not eligible", () => {
    expect(isEligibleForDepositDeadline("completed", false)).toBe(false);
  });

  it("DEPOSIT_DEADLINE_STATUSES 涵蓋 pending 與 confirmed", () => {
    expect(DEPOSIT_DEADLINE_STATUSES).toEqual(["pending", "confirmed"]);
  });
});

describe("deposit deadline integration (status + timing)", () => {
  const createdAt = "2026-06-01T00:00:00Z";
  const startTime = "2026-06-10T18:00:00Z";

  it("confirmed + unpaid + 已過期限 → 應釋放（資格 + 時間皆符合）", () => {
    expect(isEligibleForDepositDeadline("confirmed", false)).toBe(true);
    const deadline = computeDepositDeadline(createdAt, startTime);
    const afterDeadline = new Date("2026-06-03T00:00:00Z");
    expect(shouldAutoRelease(deadline, afterDeadline)).toBe(true);
  });

  it("confirmed + paid → 即使過期也不應納入 Cron 查詢", () => {
    expect(isEligibleForDepositDeadline("confirmed", true)).toBe(false);
  });

  it("confirmed + unpaid + 在提醒視窗內 → 應提醒", () => {
    const createdAt = "2026-06-01T00:00:00Z";
    const startTime = "2026-06-10T18:00:00Z";
    const deadline = computeDepositDeadline(createdAt, startTime);
    // 期限為 created+24h = 06-02；提醒視窗為期限前 24h 內
    const now = new Date("2026-06-01T12:00:00Z");
    expect(isEligibleForDepositDeadline("confirmed", false)).toBe(true);
    expect(shouldSendDepositReminder(deadline, null, now)).toBe(true);
  });

  it("已過 start_time 的 confirmed + unpaid 仍符合資格（由 Cron 清理佔位）", () => {
    expect(isEligibleForDepositDeadline("confirmed", false)).toBe(true);
    const pastStart = "2026-06-01T08:00:00Z";
    const deadline = computeDepositDeadline(createdAt, pastStart);
    expect(shouldAutoRelease(deadline, new Date("2026-06-02T00:00:00Z"))).toBe(true);
  });
});
