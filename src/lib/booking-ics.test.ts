import { describe, expect, it } from "vitest";
import { buildBookingIcs, toIcsUtc } from "./booking-ics";

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
});
