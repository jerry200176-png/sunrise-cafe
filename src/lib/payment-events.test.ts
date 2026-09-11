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

  it("文字與圖片回覆明確表示等待店家確認，不要求重複付款", () => {
    expect(GUEST_REPLY_PAYMENT_PENDING_REVIEW).toContain("已收到您的付款回報，等待店家確認");
    expect(GUEST_REPLY_PAYMENT_PENDING_REVIEW).toContain("請勿重複付款");
    expect(GUEST_REPLY_PAYMENT_PENDING_REVIEW).not.toContain("訂金已確認");
  });
});
