import { describe, it, expect } from "vitest";
import {
  getPaymentSubmissionOutcome,
  PAYMENT_IMAGE_PAYLOAD,
} from "./payment-events";

describe("getPaymentSubmissionOutcome", () => {
  it("line_image → pending_review", () => {
    expect(getPaymentSubmissionOutcome("line_image")).toBe("pending_review");
  });

  it("line_text → auto_mark_paid（過渡期）", () => {
    expect(getPaymentSubmissionOutcome("line_text")).toBe("auto_mark_paid");
  });

  it("admin / bank_csv / gateway → pending_review", () => {
    expect(getPaymentSubmissionOutcome("admin")).toBe("pending_review");
    expect(getPaymentSubmissionOutcome("bank_csv")).toBe("pending_review");
    expect(getPaymentSubmissionOutcome("gateway")).toBe("pending_review");
  });
});

describe("PAYMENT_IMAGE_PAYLOAD", () => {
  it("為固定截圖標記字串", () => {
    expect(PAYMENT_IMAGE_PAYLOAD).toBe("【付款截圖】");
  });
});
