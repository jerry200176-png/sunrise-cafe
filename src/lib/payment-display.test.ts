import { describe, expect, it } from "vitest";
import { getPaymentDisplayState } from "./payment-display";

describe("payment display state", () => {
  it("does not ask pending reports to pay or report again", () => {
    expect(getPaymentDisplayState({ is_deposit_paid: false, payment_review_status: "pending_review" })).toBe("pending_review");
  });
  it("only paid is confirmed", () => {
    expect(getPaymentDisplayState({ is_deposit_paid: true, payment_review_status: "pending_review" })).toBe("paid");
    expect(getPaymentDisplayState({ is_deposit_paid: false, payment_review_status: "approved" })).toBe("approved_unpaid");
  });
  it("does not infer unknown as unpaid", () => {
    expect(getPaymentDisplayState({})).toBe("unknown");
    expect(getPaymentDisplayState({ is_deposit_paid: null })).toBe("unknown");
    expect(getPaymentDisplayState({ is_deposit_paid: false, payment_review_status: "unrecognized" })).toBe("unknown");
  });
  it("offers payment only for an explicitly unpaid booking with no report", () => {
    expect(getPaymentDisplayState({ is_deposit_paid: false, payment_review_status: null })).toBe("unpaid");
    expect(getPaymentDisplayState({ is_deposit_paid: false })).toBe("unpaid");
  });
  it("keeps rejected proof out of payment CTA state", () => {
    expect(getPaymentDisplayState({ is_deposit_paid: false, payment_review_status: "rejected" })).toBe("rejected");
  });
});
