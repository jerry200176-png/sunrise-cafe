import { describe, it, expect } from "vitest";
import {
  getPaymentSubmissionOutcome,
  PAYMENT_IMAGE_PAYLOAD,
  GUEST_REPLY_PAYMENT_PENDING_REVIEW,
} from "./payment-events";

describe("getPaymentSubmissionOutcome", () => {
  it("all sources → pending_review (ADR-008 Phase 2)", () => {
    expect(getPaymentSubmissionOutcome("line_image")).toBe("pending_review");
    expect(getPaymentSubmissionOutcome("line_text")).toBe("pending_review");
    expect(getPaymentSubmissionOutcome("admin")).toBe("pending_review");
    expect(getPaymentSubmissionOutcome("bank_csv")).toBe("pending_review");
    expect(getPaymentSubmissionOutcome("gateway")).toBe("pending_review");
  });
});

describe("PAYMENT_IMAGE_PAYLOAD", () => {
  it("為固定截圖標記字串", () => {
    expect(PAYMENT_IMAGE_PAYLOAD).toBe("【付款截圖】");
  });

  it("文字與圖片回覆一致", () => {
    expect(GUEST_REPLY_PAYMENT_PENDING_REVIEW).toContain("店家確認");
  });
});
