/**
 * Configurable cancellation / refund policy model.
 * Final legal copy is Founder-owned; code ships conservative defaults
 * that never claim an automatic bank refund until configured.
 */

export type RefundEligibility =
  | "self_cancel_free" // unpaid, outside lock window
  | "staff_review_required" // paid deposit — must not auto-promise money back
  | "locked_contact_store" // inside time lock
  | "not_applicable";

export type RefundRequestStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "processed"
  | "withdrawn";

export type CancelRefundPolicy = {
  /** Hours before start when guest self-cancel of unpaid booking closes */
  unpaid_self_cancel_hours: number;
  /**
   * Hours before start after which paid-deposit guests must contact staff
   * (conservative; Founder may widen refund window later).
   */
  paid_contact_hours: number;
  /**
   * When true, system may auto-create refund_request rows on guest cancel attempt.
   * Money movement still requires staff/gateway processing.
   */
  allow_refund_request_workflow: boolean;
  guest_copy: {
    unpaid_locked: string;
    paid_contact: string;
    refund_request_ack: string;
  };
};

/** Conservative default — does not invent automatic refund promises. */
export const DEFAULT_CANCEL_REFUND_POLICY: CancelRefundPolicy = {
  unpaid_self_cancel_hours: 24,
  paid_contact_hours: 48,
  allow_refund_request_workflow: true,
  guest_copy: {
    unpaid_locked: "預約時間 24 小時內不可自行取消，請來電店家",
    paid_contact:
      "已付訂金的訂位請來電或透過查詢頁提出退訂申請，由店家依政策審核（不保證自動退款）",
    refund_request_ack:
      "已收到退訂／退費申請，店家審核後會以 LINE 或電話通知結果",
  },
};

export function evaluateGuestCancel(opts: {
  isDepositPaid: boolean;
  startTimeMs: number;
  nowMs?: number;
  policy?: CancelRefundPolicy;
}): { allowed: boolean; eligibility: RefundEligibility; message?: string } {
  const policy = opts.policy ?? DEFAULT_CANCEL_REFUND_POLICY;
  const now = opts.nowMs ?? Date.now();
  const hoursLeft = (opts.startTimeMs - now) / (60 * 60 * 1000);

  if (opts.isDepositPaid) {
    if (hoursLeft < policy.paid_contact_hours) {
      return {
        allowed: false,
        eligibility: "locked_contact_store",
        message: policy.guest_copy.paid_contact,
      };
    }
    return {
      allowed: false,
      eligibility: "staff_review_required",
      message: policy.guest_copy.paid_contact,
    };
  }

  if (hoursLeft < policy.unpaid_self_cancel_hours) {
    return {
      allowed: false,
      eligibility: "locked_contact_store",
      message: policy.guest_copy.unpaid_locked,
    };
  }

  return { allowed: true, eligibility: "self_cancel_free" };
}
