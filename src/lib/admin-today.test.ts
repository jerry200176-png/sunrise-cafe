import { describe, expect, it } from "vitest";
import {
  filterPaymentReviewsForBranch,
  isWithinTaipeiDay,
  taipeiDateKey,
  taipeiDayWindow,
} from "./admin-today";
import type { PendingPaymentEvent } from "./payment-events-admin";

describe("taipeiDayWindow", () => {
  it("bounds are +08:00 midnight and +24h", () => {
    const w = taipeiDayWindow("2026-07-15");
    expect(w.startIso).toBe("2026-07-14T16:00:00.000Z");
    expect(w.endIso).toBe("2026-07-15T16:00:00.000Z");
    expect(w.endMs - w.startMs).toBe(24 * 3600_000);
  });

  it("rejects invalid date", () => {
    expect(() => taipeiDayWindow("07/15/2026")).toThrow(/invalid date/);
  });
});

describe("isWithinTaipeiDay", () => {
  it("includes start of day, excludes next midnight", () => {
    expect(isWithinTaipeiDay("2026-07-14T16:00:00.000Z", "2026-07-15")).toBe(true);
    expect(isWithinTaipeiDay("2026-07-15T15:59:59.000Z", "2026-07-15")).toBe(true);
    expect(isWithinTaipeiDay("2026-07-15T16:00:00.000Z", "2026-07-15")).toBe(false);
  });
});

describe("filterPaymentReviewsForBranch", () => {
  const mk = (id: string, reservation_id: string): PendingPaymentEvent => ({
    id,
    reservation_id,
    source: "line_image",
    status: "pending_review",
    raw_payload: null,
    created_at: new Date().toISOString(),
    booking_code: "X",
    customer_name: "A",
    phone: "09",
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    total_price: 100,
    is_deposit_paid: false,
    deposit_amount: 50,
  });

  it("keeps only matching reservation ids", () => {
    const reviews = [mk("1", "r1"), mk("2", "r2"), mk("3", "r9")];
    const filtered = filterPaymentReviewsForBranch(reviews, new Set(["r1", "r9"]));
    expect(filtered.map((r) => r.id)).toEqual(["1", "3"]);
  });
});

describe("taipeiDateKey", () => {
  it("returns YYYY-MM-DD", () => {
    expect(taipeiDateKey(new Date("2026-07-15T02:00:00.000Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
