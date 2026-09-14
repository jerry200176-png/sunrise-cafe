/**
 * 付款事件狀態與提交結果（純函式，供 webhook / admin 共用）。
 * 見 docs/PAYMENT_STATE_MODEL.md
 */

export type PaymentEventSource =
  | "line_text"
  | "line_image"
  | "admin"
  | "bank_csv"
  | "gateway"
  | "bank_transfer";

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

export const BANK_TRANSFER_REPORT_SOURCE = "bank_transfer" as const;

export type TransferReportInput = {
  accountLastFive: unknown;
  amount: unknown;
};

export type TransferReportValidation =
  | { ok: true; accountLastFive: string; amount: number }
  | { ok: false; field: "accountLastFive" | "amount"; error: string };

/** Validate only the minimum customer-supplied transfer identifiers. */
export function validateTransferReport(input: TransferReportInput): TransferReportValidation {
  const accountLastFive = typeof input.accountLastFive === "string" ? input.accountLastFive.trim() : "";
  if (!/^\d{5}$/.test(accountLastFive)) {
    return { ok: false, field: "accountLastFive", error: "請填寫正確的匯款帳號後五碼" };
  }

  const rawAmount = typeof input.amount === "number" ? String(input.amount) : String(input.amount ?? "").trim();
  if (!/^\d+$/.test(rawAmount)) {
    return { ok: false, field: "amount", error: "請填寫正確的實際匯款金額" };
  }
  const amount = Number(rawAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, field: "amount", error: "請填寫正確的實際匯款金額" };
  }

  return { ok: true, accountLastFive, amount };
}

export const GUEST_REPLY_PAYMENT_PENDING_REVIEW =
  "已收到您的付款回報，等待店家確認。店家確認後會另行通知，請勿重複付款。";

export const GUEST_REPLY_PAYMENT_AUTO_RECORDED =
  "已收到您的付款通知，系統已自動記錄，感謝您！";

export const GUEST_REPLY_BANK_TRANSFER_REPORTED =
  "已收到您的匯款回報，待店家核對後會自動通知您，不需要另外傳 LINE。";
