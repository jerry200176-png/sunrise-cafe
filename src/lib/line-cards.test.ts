import { describe, expect, it } from "vitest";
import {
  buildDepositReleasedGroupFlex,
  buildGuestBindErrorFlex,
  buildGuestDepositReleasedFlex,
  buildGuestPaymentApprovedFlex,
  buildGuestPaymentPendingFlex,
  buildPaymentFlex,
  buildPaymentPendingReviewGroupFlex,
  buildReminderDigestFlex,
  buildRescheduleGroupFlex,
  buildReviewInviteFlex,
  buildWaitlistBookedGroupFlex,
  buildWaitlistFlex,
} from "@/lib/line-cards";

function assertValidBubble(flex: Record<string, unknown>, label: string) {
  expect(flex.type, `${label} type`).toBe("bubble");
  expect(flex.size, `${label} size`).toBe("mega");
  expect(flex.header, `${label} header`).toBeTruthy();
  expect(flex.body, `${label} body`).toBeTruthy();
  const json = JSON.stringify(flex);
  expect(json.length, `${label} json size`).toBeLessThan(50_000);
  expect(json).not.toContain("undefined");
}

describe("line-cards LINE API shape", () => {
  const times = {
    startTime: "2026-07-15T10:00:00+08:00",
    endTime: "2026-07-15T12:00:00+08:00",
  };

  it("all guest notification builders produce valid bubbles", () => {
    assertValidBubble(buildPaymentFlex({
      customerName: "測試",
      ...times,
      total: 1200,
      branch: { name: "昇昇咖啡", payment_info: "銀行 123" },
      bookingCode: "ABC123",
    }), "payment");

    assertValidBubble(buildGuestPaymentPendingFlex(), "payment-pending");
    assertValidBubble(buildGuestPaymentApprovedFlex({
      customerName: "測試",
      bookingCode: "ABC123",
      ...times,
    }), "payment-approved");
    assertValidBubble(buildGuestDepositReleasedFlex({
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      ...times,
    }), "deposit-released");
    assertValidBubble(buildGuestBindErrorFlex("not_found"), "bind-error");
    assertValidBubble(buildWaitlistFlex({ ...times, confirmToken: "tok123" }), "waitlist");
    assertValidBubble(buildReviewInviteFlex({
      customerName: "測試",
      branchName: "大安店",
      reviewUrl: "https://g.page/review",
    }), "review");
  });

  it("all group notification builders produce valid bubbles", () => {
    assertValidBubble(buildPaymentPendingReviewGroupFlex({
      customerName: "測試",
      bookingCode: "ABC123",
    }), "group-pending");
    assertValidBubble(buildDepositReleasedGroupFlex({
      customerName: "測試",
      phone: "0912345678",
      bookingCode: "ABC123",
      ...times,
    }), "group-released");
    assertValidBubble(buildRescheduleGroupFlex({
      customerName: "測試",
      phone: "0912345678",
      bookingCode: "ABC123",
      oldStart: times.startTime,
      oldEnd: times.endTime,
      newStart: "2026-07-16T14:00:00+08:00",
      newEnd: "2026-07-16T16:00:00+08:00",
    }), "reschedule");
    assertValidBubble(buildWaitlistBookedGroupFlex({
      customerName: "測試",
      phone: "0912345678",
      bookingCode: "ABC123",
      roomLabel: "大安 — A",
      ...times,
    }), "waitlist-booked");
  });

  it("reminder digest carousel has <=12 bubbles", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      booking_code: `CODE${i}`,
      room_name: "A",
      branch_name: "昇昇",
      start_time: times.startTime,
      end_time: times.endTime,
      customer_name: `客人${i}`,
      phone: "0912345678",
    }));
    const flex = buildReminderDigestFlex(rows);
    expect(flex.type).toBe("carousel");
    const contents = flex.contents as unknown[];
    expect(contents.length).toBeLessThanOrEqual(12);
  });
});
