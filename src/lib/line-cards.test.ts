import { describe, expect, it } from "vitest";
import {
  buildDepositReleasedGroupFlex,
  buildGuestAttendanceConfirmedFlex,
  buildGuestAttendanceConfirmedGroupFlex,
  buildGuestBindErrorFlex,
  buildGuestDepositReleasedFlex,
  buildGuestDepositReminderFlex,
  buildGuestPaymentApprovedFlex,
  buildGuestPaymentPendingFlex,
  buildPaymentFlex,
  buildPaymentPendingReviewGroupFlex,
  buildReminderDigestFlex,
  buildReminderDigestFlexChunks,
  buildReminderFlex,
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
    assertValidBubble(buildGuestPaymentPendingFlex({ bookingCode: "ABC123" }), "payment-pending-with-code");
    assertValidBubble(buildGuestPaymentApprovedFlex({
      customerName: "測試",
      bookingCode: "ABC123",
      ...times,
    }), "payment-approved");
    const approvedWithToken = buildGuestPaymentApprovedFlex({
      customerName: "測試",
      bookingCode: "ABC123",
      lookupToken: "token-abc-123",
      ...times,
    });
    assertValidBubble(approvedWithToken, "payment-approved-token");
    expect(JSON.stringify(approvedWithToken)).toContain("token=token-abc-123");
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

  it("names the actual store on review invites instead of assuming 大安", () => {
    const secondStore = JSON.stringify(buildReviewInviteFlex({
      customerName: "測試",
      branchName: "昇昇咖啡 (信義店)",
      reviewUrl: "https://g.page/review",
    }));
    expect(secondStore).toContain("昇昇咖啡 (信義店)");
    expect(secondStore).not.toContain("大安");
    expect(JSON.stringify(buildReviewInviteFlex({
      customerName: "測試",
      branchName: "",
      reviewUrl: "https://g.page/review",
    }))).toContain("昇昇咖啡");
  });

  it("keeps payment-report, approved, and delayed-request copy unambiguous", () => {
    const request = JSON.stringify(
      buildPaymentFlex({
        customerName: "測試",
        ...times,
        total: 1200,
        branch: { name: "昇昇咖啡", payment_info: "銀行 123" },
        bookingCode: "ABC123",
      })
    );
    const pending = JSON.stringify(buildGuestPaymentPendingFlex({ bookingCode: "ABC123" }));
    const approved = JSON.stringify(
      buildGuestPaymentApprovedFlex({ customerName: "測試", bookingCode: "ABC123", ...times })
    );

    expect(request).toContain("若已收到「訂金已確認」，本則通知可忽略");
    expect(pending).toContain("已收到您的付款回報，等待店家確認");
    expect(pending).not.toContain("訂金已確認");
    expect(approved).toContain("訂金已確認");
    expect(approved).not.toContain("等待店家確認");
  });

  it("keeps complete deposit payloads and CTAs ordered by payment state", () => {
    const request = JSON.stringify(buildPaymentFlex({
      customerName: "測試", ...times, total: 1200,
      branch: { name: "昇昇咖啡", payment_info: "銀行 123", line_pay_url: "https://pay.example/deposit" },
      bookingCode: "ABC123",
    }));
    const pending = JSON.stringify(buildGuestPaymentPendingFlex({ bookingCode: "ABC123" }));
    const approved = JSON.stringify(buildGuestPaymentApprovedFlex({
      customerName: "測試", bookingCode: "ABC123", ...times,
    }));

    // Unpaid: payment CTA is present; the delayed-card warning is after payment instructions.
    expect(request).toContain("LINE Pay 付款");
    expect(request).toContain("https://pay.example/deposit");
    expect(request.indexOf("匯款後請回傳")).toBeLessThan(request.indexOf("若您已回報付款"));
    // Pending review: no payment CTA or approval claim, only review/status guidance.
    expect(pending).toContain("付款回報已收到");
    expect(pending).toContain("查看訂位狀態");
    expect(pending).not.toContain("LINE Pay 付款");
    expect(pending).not.toContain("訂金已確認");
    // Approved after a delayed claim: no payment CTA; approval is the terminal guest message.
    expect(approved).toContain("訂金已確認");
    expect(approved).toContain("查看訂位詳情");
    expect(approved).not.toContain("LINE Pay 付款");
    expect(approved).not.toContain("請勿重複付款");
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

  it("reminder Flex includes confirm attendance CTA when URL provided", () => {
    const flex = buildReminderFlex({
      leadLabel: "明日",
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      confirmAttendanceUrl: "https://example.com/book/confirm-visit?token=tok",
      ...times,
    });
    assertValidBubble(flex, "reminder-confirm");
    const json = JSON.stringify(flex);
    expect(json).toContain("確認準時到店");
    expect(json).toContain("confirm-visit?token=tok");
    expect(json).toContain("code=ABC123");
  });

  it("reminder Flex prefers lookup token over code for query deep link", () => {
    const withToken = buildReminderFlex({
      leadLabel: "明日",
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      lookupToken: "lookup-tok-1",
      confirmAttendanceUrl: "https://example.com/book/confirm-visit?token=att",
      ...times,
    });
    const withTokenJson = JSON.stringify(withToken);
    expect(withTokenJson).toContain("token=lookup-tok-1");
    expect(withTokenJson).not.toContain("code=ABC123");

    const legacy = buildReminderFlex({
      leadLabel: "明日",
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      ...times,
    });
    const legacyJson = JSON.stringify(legacy);
    expect(legacyJson).toContain("code=ABC123");
    expect(legacyJson).not.toContain("token=");
  });

  it("attendance confirmed Flex prefers lookup token for 查看訂位詳情", () => {
    const withToken = buildGuestAttendanceConfirmedFlex({
      customerName: "測試",
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      lookupToken: "att-lookup-1",
      ...times,
    });
    const json = JSON.stringify(withToken);
    expect(json).toContain("token=att-lookup-1");
    expect(json).not.toContain("code=ABC123");
    expect(json).toContain("ABC123"); // still shown as row label value

    const legacy = buildGuestAttendanceConfirmedFlex({
      customerName: "測試",
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      ...times,
    });
    expect(JSON.stringify(legacy)).toContain("code=ABC123");
  });

  it("deposit reminder Flex deep-links query with code and urgent copy", () => {
    const flex = buildGuestDepositReminderFlex({
      branchName: "昇昇咖啡",
      bookingCode: "XYZ789",
      ...times,
      urgency: "soon",
      deadlineLabel: "2026/07/15 (三) 18:00",
    });
    assertValidBubble(flex, "deposit-urgent");
    const json = JSON.stringify(flex);
    expect(json).toContain("訂金即將逾期");
    expect(json).toContain("code=XYZ789");
    expect(json).toContain("2026/07/15");
  });

  it("attendance confirmed group Flex is valid", () => {
    assertValidBubble(
      buildGuestAttendanceConfirmedGroupFlex({
        customerName: "測試",
        phone: "0912345678",
        bookingCode: "ABC123",
        roomLabel: "A",
        ...times,
      }),
      "attendance-confirmed"
    );
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

  it("reminder digest chunks cover all rows without silent drop", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      booking_code: `CODE${i}`,
      room_name: "A",
      branch_name: "昇昇",
      start_time: times.startTime,
      end_time: times.endTime,
      customer_name: `客人${i}`,
      phone: "0912345678",
    }));
    const chunks = buildReminderDigestFlexChunks(rows);
    expect(chunks).toHaveLength(3);
    const bubbleCount = chunks.reduce(
      (n, c) => n + ((c.contents as unknown[])?.length ?? 0),
      0
    );
    expect(bubbleCount).toBe(25);
  });
});
