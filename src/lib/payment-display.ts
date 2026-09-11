export type PaymentDisplayState =
  | "paid" | "pending_review" | "approved_unpaid" | "rejected" | "unpaid" | "unknown";

/** Presentation only: neither notification delivery nor a return URL proves receipt. */
export function getPaymentDisplayState(input: {
  is_deposit_paid?: boolean | null;
  payment_review_status?: string | null;
}): PaymentDisplayState {
  if (input.is_deposit_paid === true) return "paid";
  if (input.is_deposit_paid !== false) return "unknown";
  if (input.payment_review_status === "pending_review") return "pending_review";
  if (input.payment_review_status === "approved") return "approved_unpaid";
  if (input.payment_review_status === "rejected") return "rejected";
  return input.payment_review_status == null ? "unpaid" : "unknown";
}
