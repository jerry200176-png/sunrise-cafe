import { describe, expect, it } from "vitest";
import { buildReport } from "./report-builder";
import type { ReportReservation } from "./overview-data";

const NOW = new Date("2026-10-08T04:00:00Z"); // 台北 10/8 12:00
const room = (id: string, name: string, branch = "大安店") => ({ id, name, branch_id: "b", branch: { name: branch } });
const res = (o: Partial<ReportReservation>): ReportReservation => ({
  status: "confirmed", total_price: 1000, is_deposit_paid: false, guest_count: 2, start_time: "2026-10-05T06:00:00Z", room: room("r1", "A包廂"), ...o,
});

describe("buildReport", () => {
  const rows = [
    res({ is_deposit_paid: true }),
    res({ status: "completed", is_deposit_paid: true, start_time: "2026-09-10T06:00:00Z", room: room("r2", "B包廂") }),
    res({ status: "cancelled", start_time: "2026-09-11T06:00:00Z" }),
    res({ start_time: "2026-10-20T02:00:00Z" }), // 未來
  ];
  const r = buildReport(rows, [{ status: "completed", total_amount: 300, created_at: "2026-10-06T00:00:00Z" }], 2, NOW, false);

  it("deposit rate uses the displayed booking count (completed bookings count too)", () => {
    expect(r.summary.bookings).toBe(3);
    expect(r.summary.deposit_paid_count).toBe(2);
    expect(r.summary.deposit_rate).toBeCloseTo(0.667, 3);
    expect(r.summary.cancellation_rate).toBe(0.25);
  });
  it("received is split by month; nothing is summed across deposits and menu orders", () => {
    expect(r.monthly.map((m) => [m.label, m.bookings, m.received_deposits, m.received_orders])).toEqual([
      ["9 月", 1, 500, 0],
      ["10 月", 2, 500, 300],
    ]);
    expect(r.summary).not.toHaveProperty("total_revenue");
  });
  it("hours are Taipei local and rooms carry the branch name only when multi-branch", () => {
    expect(r.by_hour.find((h) => h.hour === 14)!.count).toBe(2); // 06:00Z = 14:00 台北
    expect(r.by_room[0].name).toBe("A包廂");
    expect(buildReport(rows, [], 2, NOW, true).by_room[0].name).toBe("大安店 A包廂");
  });
  it("month list does not skip months at the 31st (no setMonth overflow)", () => {
    const jul31 = buildReport([], [], 6, new Date("2026-07-31T04:00:00Z"), false);
    expect(jul31.monthly.map((m) => m.month)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  });
});
