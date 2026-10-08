import { describe, expect, it } from "vitest";
import { summarizeBusiness, taipeiMonthRange } from "./business-metrics";

const NOW = new Date("2026-10-08T04:00:00Z");
const res = (o: Partial<Parameters<typeof summarizeBusiness>[0][number]>) => ({
  status: "confirmed", total_price: 1000, is_deposit_paid: false, guest_count: 4, start_time: "2026-10-05T06:00:00Z", ...o,
});

describe("summarizeBusiness", () => {
  it("keeps received and expected separate and never sums them", () => {
    const s = summarizeBusiness(
      [
        res({ is_deposit_paid: true }), // 過去、已付：實收 500
        res({ start_time: "2026-10-20T06:00:00Z", total_price: 2000 }), // 未來未付：預計 2000，未收訂金 1000
        res({ start_time: "2026-10-21T06:00:00Z", total_price: 1000, is_deposit_paid: true }), // 未來已付：預計 1000、實收 500
        res({ status: "cancelled", is_deposit_paid: true }),
      ],
      [
        { status: "completed", total_amount: 300 },
        { status: "ready", total_amount: 999, paid_at: null }, // 還沒結帳
        { status: "ready", total_amount: 200, paid_at: "2026-10-06T00:00:00Z" },
        { status: "cancelled", total_amount: 50, paid_at: "2026-10-06T00:00:00Z" },
      ],
      NOW
    );
    expect(s.received_deposits).toBe(1000);
    expect(s.received_orders).toBe(500);
    expect(s.expected_upcoming).toBe(3000);
    expect(s.unpaid_deposits).toBe(1000);
    expect(s.bookings).toBe(3);
    expect(s.guests).toBe(12);
    expect(s.cancelled).toBe(1);
  });

  it("deposit rate denominator is the same bookings count that is displayed", () => {
    const s = summarizeBusiness(
      [res({ is_deposit_paid: true }), res({ status: "checked_in", is_deposit_paid: true }), res({}), res({ status: "completed" })],
      [],
      NOW
    );
    expect(s.bookings).toBe(4);
    expect(s.deposit_paid_count).toBe(2);
    expect(s.deposit_rate).toBe(0.5);
  });

  it("no bookings -> null rate, not 0", () => {
    expect(summarizeBusiness([], [], NOW).deposit_rate).toBeNull();
  });
});

describe("taipeiMonthRange", () => {
  it("uses Taipei month boundaries (UTC 16:00 on the last day is already next month)", () => {
    const r = taipeiMonthRange(new Date("2026-09-30T17:00:00Z"));
    expect(r.label).toBe("10 月");
    expect(r.from).toBe("2026-09-30T16:00:00.000Z");
    expect(r.to).toBe("2026-10-31T16:00:00.000Z");
  });
  it("previous month across a year boundary and no day-31 overflow", () => {
    const r = taipeiMonthRange(new Date("2026-01-31T03:00:00Z"), -1);
    expect(r.label).toBe("12 月");
    expect(r.from).toBe("2025-11-30T16:00:00.000Z");
    expect(r.to).toBe("2025-12-31T16:00:00.000Z");
  });
});
