import { describe, expect, it } from "vitest";
import { hoursForDate, validateWeeklyHours, weekdayKeyForDate } from "./branch-hours";

// 同德店: 週二至週五 14-18, 週六日 10-18, 週一公休
const tongde = {
  open_time: "10:00",
  close_time: "18:00",
  weekly_hours: {
    sun: { open: "10:00", close: "18:00" },
    mon: null,
    tue: { open: "14:00", close: "18:00" },
    wed: { open: "14:00", close: "18:00" },
    thu: { open: "14:00", close: "18:00" },
    fri: { open: "14:00", close: "18:00" },
    sat: { open: "10:00", close: "18:00" },
  },
};

describe("weekdayKeyForDate", () => {
  it("uses the Taiwan calendar day", () => {
    expect(weekdayKeyForDate("2026-10-05")).toBe("mon");
    expect(weekdayKeyForDate("2026-10-06")).toBe("tue");
    expect(weekdayKeyForDate("2026-10-10")).toBe("sat");
    expect(weekdayKeyForDate("2026-10-11")).toBe("sun");
  });
});

describe("hoursForDate", () => {
  it("returns that weekday's hours, or null when closed", () => {
    expect(hoursForDate(tongde, "2026-10-05")).toBeNull();
    expect(hoursForDate(tongde, "2026-10-06")).toEqual({ open: "14:00", close: "18:00" });
    expect(hoursForDate(tongde, "2026-10-10")).toEqual({ open: "10:00", close: "18:00" });
  });

  it("keeps the branch-wide times when weekly hours are unset or a weekday is not listed", () => {
    const daan = { open_time: "09:00", close_time: "21:00", weekly_hours: null };
    expect(hoursForDate(daan, "2026-10-05")).toEqual({ open: "09:00", close: "21:00" });
    const partial = { open_time: "09:00", close_time: "21:00", weekly_hours: { mon: null } };
    expect(hoursForDate(partial, "2026-10-06")).toEqual({ open: "09:00", close: "21:00" });
    expect(hoursForDate(partial, "2026-10-05")).toBeNull();
  });
});

describe("validateWeeklyHours", () => {
  it("accepts null, closed days and valid ranges", () => {
    expect(validateWeeklyHours(null)).toBeNull();
    expect(validateWeeklyHours(tongde.weekly_hours)).toBeNull();
  });

  it("rejects bad keys, formats and reversed ranges", () => {
    expect(validateWeeklyHours({ monday: null })).toMatch(/未知/);
    expect(validateWeeklyHours({ tue: { open: "2pm", close: "18:00" } })).toMatch(/HH:MM/);
    expect(validateWeeklyHours({ tue: { open: "18:00", close: "14:00" } })).toMatch(/早於/);
    expect(validateWeeklyHours([])).toMatch(/格式/);
  });
});

describe("admin form rows", () => {
  it("round-trips the 同德店 schedule, Monday first", async () => {
    const { weeklyToFormRows, formRowsToWeekly } = await import("./branch-hours");
    const rows = weeklyToFormRows(tongde.weekly_hours, "10:00", "18:00");
    expect(rows.map((r) => r.key)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    expect(rows[0]).toMatchObject({ key: "mon", closed: true });
    expect(rows[1]).toMatchObject({ key: "tue", closed: false, open: "14:00", close: "18:00" });
    expect(formRowsToWeekly(rows)).toEqual(tongde.weekly_hours);
  });

  it("starts from the branch-wide hours when nothing is set yet", async () => {
    const { weeklyToFormRows } = await import("./branch-hours");
    expect(weeklyToFormRows(null, "09:00", "21:00").every((r) => !r.closed && r.open === "09:00" && r.close === "21:00")).toBe(true);
  });
});
