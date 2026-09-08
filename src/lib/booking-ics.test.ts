import { describe, expect, it } from "vitest";
import { buildBookingIcs, buildGoogleCalendarUrl, toIcsUtc } from "./booking-ics";

describe("booking-ics", () => {
  it("emits valid VEVENT with UTC times", () => {
    const ics = buildBookingIcs({
      bookingCode: "ABC123",
      summary: "昇昇咖啡 · 包廂 A",
      description: "訂位碼 ABC123",
      location: "大安店",
      startTime: "2026-07-16T02:00:00.000Z",
      endTime: "2026-07-16T04:00:00.000Z",
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:ABC123@sunrise-cafe");
    expect(ics).toContain(`DTSTART:${toIcsUtc("2026-07-16T02:00:00.000Z")}`);
    expect(ics).toContain("LOCATION:大安店");
  });

  it("builds correct Google Calendar template URL", () => {
    const url = buildGoogleCalendarUrl({
      summary: "昇昇咖啡 · 包廂 A",
      description: "訂位碼 ABC123",
      location: "台北市大安區",
      startTime: "2026-07-16T02:00:00.000Z",
      endTime: "2026-07-16T04:00:00.000Z",
    });
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("text=%E6%98%87%E6%98%87%E5%92%96%E5%95%A1+%C2%B7+%E5%8C%85%E5%BB%82+A");
    expect(url).toContain("dates=20260716T020000Z%2F20260716T040000Z");
    expect(url).toContain("location=%E5%8F%B0%E5%8C%97%E5%B8%82%E5%A4%A7%E5%AE%89%E5%8D%80");
  });
});

