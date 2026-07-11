/**
 * 付款事件狀態與提交結果（純函式，供 webhook / admin 共用）。
 * 見 docs/PAYMENT_STATE_MODEL.md
 */

export type PaymentEventSource =
  | "line_text"
  | "line_image"
  | "admin"
  | "bank_csv"
  | "gateway";

export type PaymentEventStatus = "pending_review" | "approved" | "rejected";

/** 客人提交後系統應採取的動作 */
export type PaymentSubmissionOutcome = "auto_mark_paid" | "pending_review";

/**
 * 依來源決定是否直接標記已付，或進入待審核佇列。
 * ADR-008 Phase 2：所有客人 LINE 提交一律 pending_review。
 */
export function getPaymentSubmissionOutcome(
  source: PaymentEventSource
): PaymentSubmissionOutcome {
  void source;
  return "pending_review";
}

export const PAYMENT_IMAGE_PAYLOAD = "【付款截圖】";

export const GUEST_REPLY_PAYMENT_PENDING_REVIEW =
  "已收到您的付款通知，店家確認後會另行通知，謝謝！";

export const GUEST_REPLY_PAYMENT_AUTO_RECORDED =
  "已收到您的付款通知，系統已自動記錄，感謝您！";
