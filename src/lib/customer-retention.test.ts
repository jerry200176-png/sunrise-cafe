import { describe, expect, it } from "vitest";
import {
  findAnniversaryOpportunities,
  findInactiveCustomers,
  findReviewInviteCandidates,
  type ReservationLite,
} from "./customer-retention";

const base = (overrides: Partial<ReservationLite>): ReservationLite => ({
  id: "1",
  phone: "0912345678",
  customer_name: "測試",
  status: "completed",
  start_time: "2025-01-15T10:00:00+08:00",
  created_at: "2025-01-01T08:00:00+08:00",
  line_user_id: "U123",
  review_invited_at: null,
  ...overrides,
});

describe("customer-retention", () => {
  it("finds inactive customers past cutoff", () => {
    const now = new Date("2026-07-10T12:00:00+08:00");
    const rows = [
      base({ start_time: "2025-01-15T10:00:00+08:00" }),
      base({ id: "2", phone: "0987654321", start_time: "2026-06-01T10:00:00+08:00" }),
    ];
    const inactive = findInactiveCustomers(rows, 90, now);
    expect(inactive).toHaveLength(1);
    expect(inactive[0].phone_masked).toContain("***");
    expect(inactive[0].booking_count).toBe(1);
  });

  it("finds review invite candidates", () => {
    const rows = [
      base({ review_invited_at: null, line_user_id: "U1" }),
      base({ id: "2", review_invited_at: "2026-01-01", line_user_id: "U2" }),
      base({ id: "3", status: "confirmed", line_user_id: "U3" }),
    ];
    const candidates = findReviewInviteCandidates(rows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].line_bound).toBe(true);
  });

  it("finds anniversary opportunities within window", () => {
    const now = new Date("2026-07-05T12:00:00+08:00");
    const rows = [
      base({
        created_at: "2024-07-10T08:00:00+08:00",
        start_time: "2025-07-10T10:00:00+08:00",
      }),
    ];
    const anniversaries = findAnniversaryOpportunities(rows, 14, now);
    expect(anniversaries).toHaveLength(1);
    expect(anniversaries[0].years).toBeGreaterThanOrEqual(1);
    expect(anniversaries[0].phone_masked).toContain("***");
  });
});
