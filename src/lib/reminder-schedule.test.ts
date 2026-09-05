import { describe, expect, it } from "vitest";
import { reminderScheduleWindow } from "./reminder-schedule";

describe("reminderScheduleWindow", () => {
  it("allows Vercel Hobby delivery during the 20:00–20:59 Taipei window", () => {
    expect(
      reminderScheduleWindow("cron", new Date("2026-09-04T12:59:59.000Z")).allowed
    ).toBe(true);
  });

  it("rejects Vercel cron outside its Taipei window", () => {
    expect(
      reminderScheduleWindow("cron", new Date("2026-09-04T13:00:00.000Z")).allowed
    ).toBe(false);
  });

  it("allows the GitHub backup after the primary window but before midnight", () => {
    expect(
      reminderScheduleWindow("github", new Date("2026-09-04T13:10:00.000Z")).allowed
    ).toBe(true);
    expect(
      reminderScheduleWindow("github", new Date("2026-09-04T15:59:59.000Z")).allowed
    ).toBe(true);
  });

  it("rejects a delayed GitHub backup after the Taipei date boundary", () => {
    const result = reminderScheduleWindow(
      "github",
      new Date("2026-09-04T16:52:31.938Z")
    );
    expect(result.allowed).toBe(false);
    expect(result.date).toBe("2026-09-05");
  });

  it("does not constrain manual sends", () => {
    expect(
      reminderScheduleWindow("manual", new Date("2026-09-04T16:52:31.938Z")).allowed
    ).toBe(true);
  });
});
