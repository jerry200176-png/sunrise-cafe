import { describe, expect, it } from "vitest";
import {
  buildGuestBindSuccessFlex,
  buildGuestPaymentPendingFlex,
  buildNewBookingFlex,
  buildPaymentFlex,
  buildReminderFlex,
} from "@/lib/line-cards";

describe("line-cards", () => {
  it("buildPaymentFlex returns mega bubble with brand header", () => {
    const flex = buildPaymentFlex({
      customerName: "王小明",
      startTime: "2026-07-15T10:00:00+08:00",
      endTime: "2026-07-15T12:00:00+08:00",
      total: 2000,
      branch: { name: "昇昇咖啡大安店", payment_info: "銀行 123", line_pay_url: null },
      bookingCode: "ABC123",
    });
    expect(flex.type).toBe("bubble");
    expect(flex.size).toBe("mega");
    expect(JSON.stringify(flex)).toContain("訂金繳費通知");
    expect(JSON.stringify(flex)).toContain("ABC123");
  });

  it("buildReminderFlex includes query page action", () => {
    const flex = buildReminderFlex({
      leadLabel: "明日",
      branchName: "昇昇咖啡",
      roomName: "包廂 A",
      startTime: "2026-07-15T10:00:00+08:00",
      endTime: "2026-07-15T12:00:00+08:00",
    });
    expect(JSON.stringify(flex)).toContain("/book/query");
  });

  it("buildNewBookingFlex is bubble for group", () => {
    const flex = buildNewBookingFlex({
      customerName: "測試",
      phone: "0912345678",
      bookingCode: "XYZ789",
      startTime: "2026-07-15T10:00:00+08:00",
      endTime: "2026-07-15T12:00:00+08:00",
    });
    expect(flex.type).toBe("bubble");
    expect(JSON.stringify(flex)).toContain("新訂位申請");
  });

  it("guest bind and payment pending use flex bubble", () => {
    expect(buildGuestBindSuccessFlex(true).type).toBe("bubble");
    expect(buildGuestPaymentPendingFlex().type).toBe("bubble");
  });
});
