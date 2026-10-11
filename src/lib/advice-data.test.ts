import { describe, expect, it } from "vitest";
import { toBranchMetrics, type AdviceRow } from "@/lib/advice-data";

const room = { id: "r1", name: "包廂1", branch_id: "b1", branch: { name: "A店" } };
const row = (o: Partial<AdviceRow>): AdviceRow => ({ status: "confirmed", total_price: 1000, is_deposit_paid: true, start_time: "2026-10-01T04:00:00Z", phone: "0911", room, ...o });

describe("toBranchMetrics", () => {
  it("counts only marked 沒來, treats cancelled as dead, buckets Taipei hours", () => {
    const [m] = toBranchMetrics([
      row({}),
      row({ status: "no_show", phone: "0922" }),
      row({ status: "cancelled", is_deposit_paid: false }),
      row({ phone: "0911", preorder: [{ status: "submitted" }] }),
      row({ status: "completed", total_price: 3000, phone: null }),
    ]);
    expect(m).toMatchObject({ bookings: 4, cancelled: 1, cancelledUnpaid: 1, noShows: 1, depositPaid: 4, preorderBookings: 1, uniqueGuests: 2, repeatGuests: 1, avgPrice: 1500 });
    expect(m.hourBookings[12]).toBe(4); // 04:00Z = 12:00 Taipei
    expect(m.rooms).toEqual([{ id: "r1", name: "包廂1", bookings: 4 }]);
  });
});
