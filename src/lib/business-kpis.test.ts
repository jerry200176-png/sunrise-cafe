import { describe, expect, it } from "vitest";
import {
  branchOpenHoursPerDay,
  computeCancellationBreakdown,
  computeCustomerReturnMetrics,
  computeFunnelConversion,
  computeOccupancyRate,
  computeRevPerAvailableRoomHour,
  computeWaitlistRecovery,
  countNoShows,
  isProbableNoShow,
  reservationDurationHours,
  splitPeakOffPeak,
  sumBookedHours,
} from "./business-kpis";

describe("reservationDurationHours", () => {
  it("computes 2 hours", () => {
    expect(
      reservationDurationHours("2026-08-15T10:00:00+08:00", "2026-08-15T12:00:00+08:00")
    ).toBe(2);
  });
});

describe("branchOpenHoursPerDay", () => {
  it("returns hours between open and close", () => {
    expect(branchOpenHoursPerDay("09:00", "21:00")).toBe(12);
  });
});

describe("occupancy and RevPAR", () => {
  const reservations = [
    {
      status: "confirmed",
      total_price: 400,
      start_time: "2026-08-15T10:00:00+08:00",
      end_time: "2026-08-15T12:00:00+08:00",
    },
  ];

  it("sums booked hours", () => {
    expect(sumBookedHours(reservations)).toBe(2);
  });

  it("computes occupancy rate", () => {
    expect(computeOccupancyRate(2, 12)).toBeCloseTo(0.1667, 3);
  });

  it("computes RevPAR", () => {
    expect(computeRevPerAvailableRoomHour(400, 12)).toBe(33);
  });
});

describe("no-show detection", () => {
  const start = "2026-01-01T10:00:00+08:00";

  it("flags confirmed past grace", () => {
    const now = new Date("2026-01-01T11:00:00+08:00").getTime();
    expect(isProbableNoShow({ status: "confirmed", start_time: start }, now)).toBe(true);
  });

  it("ignores checked_in", () => {
    const now = new Date("2026-01-01T11:00:00+08:00").getTime();
    expect(isProbableNoShow({ status: "checked_in", start_time: start }, now)).toBe(false);
  });

  it("counts no-shows", () => {
    const now = new Date("2026-01-01T11:00:00+08:00").getTime();
    expect(
      countNoShows(
        [
          { status: "confirmed", start_time: start },
          { status: "checked_in", start_time: start },
        ],
        now
      )
    ).toBe(1);
  });
});

describe("customer return metrics", () => {
  it("computes return rate", () => {
    const result = computeCustomerReturnMetrics([
      "0911111111",
      "0911111111",
      "0922222222",
    ]);
    expect(result.unique_customers).toBe(2);
    expect(result.returning_customers).toBe(1);
    expect(result.return_rate).toBe(0.5);
  });
});

describe("cancellation breakdown", () => {
  it("computes cancellation rate", () => {
    const r = computeCancellationBreakdown([
      { status: "confirmed" },
      { status: "cancelled" },
    ]);
    expect(r.cancellation_rate).toBe(0.5);
  });
});

describe("waitlist recovery", () => {
  it("computes recovery rate", () => {
    const w = computeWaitlistRecovery([
      { status: "waiting" },
      { status: "booked" },
    ]);
    expect(w.recovery_rate).toBe(0.5);
  });
});

describe("funnel conversion", () => {
  it("computes step rates", () => {
    const c = computeFunnelConversion({
      booking_started: 100,
      room_selected: 80,
      slot_selected: 60,
      booking_completed: 40,
    });
    expect(c.overall_conversion).toBe(0.4);
    expect(c.room_step_rate).toBe(0.8);
  });
});

describe("peak off-peak split", () => {
  it("splits buckets", () => {
    const split = splitPeakOffPeak(
      [
        { hour: 10, bookings: 2, revenue: 400 },
        { hour: 20, bookings: 1, revenue: 200 },
      ],
      11,
      21
    );
    expect(split.peak.bookings).toBe(1);
    expect(split.off_peak.bookings).toBe(2);
  });
});
