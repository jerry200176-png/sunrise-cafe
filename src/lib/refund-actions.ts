/**
 * 退款處理畫面與 API 共用的規則（Founder D7，2026-10-15）。和 SQL record_reservation_refund_status 一致：
 * - 人工退款標「成功」要有實際證據：非現金 = 轉帳序號／交易編號（reference）＋說明；現金 = 說明（誰、何時交給客人）
 * - 標「失敗」「取消」要寫原因
 * - Stripe 退款的任何結果（含取消）只能由 Stripe 回報或「對帳」決定；人工不能標
 * 解除結帳的「退款處理中」只能經過這些可追查的狀態變化，每一步都是帳本上一列只能新增的事件。
 */

export type ManualRefundStatus = "pending" | "succeeded" | "failed" | "canceled";
export const MANUAL_REFUND_STATUSES: readonly ManualRefundStatus[] = ["pending", "succeeded", "failed", "canceled"];

export type RefundAction = "pending" | "confirm" | "fail" | "cancel" | "reconcile";

export const REFUND_ACTION_STATUS: Record<Exclude<RefundAction, "reconcile">, ManualRefundStatus> = {
  pending: "pending",
  confirm: "succeeded",
  fail: "failed",
  cancel: "canceled",
};

export const REFUND_STATUS_LABEL: Record<string, string> = {
  requested: "已申請",
  pending: "處理中",
  succeeded: "已退",
  failed: "失敗",
  canceled: "已取消",
};

export const REFUND_METHOD_LABEL: Record<string, string> = {
  stripe: "Stripe",
  cash: "現金",
  card: "刷卡退刷",
  line_pay: "LINE Pay",
  transfer: "轉帳",
  other: "其他",
};

export const REFUND_KIND_LABEL: Record<string, string> = {
  deposit: "退訂金",
  checkout_deposit_excess: "結帳退訂金差額",
};

const blank = (value: string | null | undefined) => !value || value.trim().length === 0;

/**
 * 人工退款「證據編號」格式（Founder A6-8）。任意文字不算證據。
 * 必須和 SQL refund_reference_valid 一字不差（refund-actions.test.ts 直接讀 migration 比對）。
 * 現金沒有編號，改由操作者確認現金已交還客人（A6-3）。截圖上傳之後再做。
 */
export const REFUND_REFERENCE_PATTERNS: Record<string, string> = {
  transfer: "^(?=(?:[^0-9]*[0-9]){6})[0-9A-Za-z][0-9A-Za-z-]{5,31}$",
  line_pay: "^[0-9]{19}$",
  card: "^(?:[0-9A-Za-z]{6}|[0-9]{12})$",
  other: "^[A-Za-z]{2,12}:[0-9A-Za-z-]{6,40}$",
};

export const REFUND_REFERENCE_HINT: Record<string, string> = {
  transfer: "銀行轉帳交易序號：6–32 碼英數字或 -，至少 6 個數字",
  line_pay: "LINE Pay 交易編號（transactionId）：19 位數字",
  card: "刷卡退刷授權碼 6 碼，或 12 位數字調閱編號",
  other: "管道代碼:交易編號，例如 JKOPAY:20261015001234",
};

/** 這個退款方式的證據編號格式對不對（前後空白先去掉） */
export function refundReferenceValid(method: string, reference: string | null | undefined): boolean {
  const pattern = REFUND_REFERENCE_PATTERNS[method];
  return Boolean(pattern && reference && new RegExp(pattern).test(reference.trim()));
}

export type RefundActionProblem = "refund_evidence_required" | "refund_reason_required" | "provider_outcome_only"
  | "invalid_refund_transition" | "invalid_refund_reference" | "cash_handback_required" | "refund_failure_evidence_required";

/** 這筆退款在目前狀態下，老闆／店長可以按哪些按鈕（權限另由 API／SQL 檢查） */
export function refundActionsFor(refund: { method: string; status: string }): RefundAction[] {
  const open = refund.status === "requested" || refund.status === "pending";
  if (refund.method === "stripe") return open ? ["reconcile"] : [];
  if (refund.status === "requested") return ["pending", "confirm", "fail", "cancel"];
  if (refund.status === "pending") return ["confirm", "fail", "cancel"];
  // 人工退款事後才發現沒退成（例如轉帳被退回）：可以改標失敗，但要有退回的證據編號＋原因（A6-9）。
  // 現金已當面交還就不能再改失敗。
  if (refund.status === "succeeded" && refund.method !== "cash") return ["fail"];
  return [];
}

/** 人工標記前的檢查（API 先擋一次，SQL 再擋一次）。回傳問題代碼或 null。 */
export function manualRefundProblem(input: {
  method: string; from: string; to: string; note?: string | null; reference?: string | null; cashHandedBack?: boolean;
}): RefundActionProblem | null {
  if (input.method === "stripe") return "provider_outcome_only";
  const allowed = refundActionsFor({ method: input.method, status: input.from })
    .filter((action): action is Exclude<RefundAction, "reconcile"> => action !== "reconcile")
    .map((action) => REFUND_ACTION_STATUS[action]);
  if (!allowed.includes(input.to as ManualRefundStatus)) return "invalid_refund_transition";
  if (input.to === "succeeded") {
    if (blank(input.note)) return "refund_evidence_required";
    if (input.method === "cash") return input.cashHandedBack ? null : "cash_handback_required";
    if (blank(input.reference)) return "refund_evidence_required";
    return refundReferenceValid(input.method, input.reference) ? null : "invalid_refund_reference";
  }
  if ((input.to === "failed" || input.to === "canceled") && blank(input.note)) return "refund_reason_required";
  if (input.from === "succeeded" && input.to === "failed" && !refundReferenceValid(input.method, input.reference)) {
    return "refund_failure_evidence_required";
  }
  return null;
}
