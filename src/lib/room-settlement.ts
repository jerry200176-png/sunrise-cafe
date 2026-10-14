/**
 * 結帳紀錄（#444）：settle_reservation_checkout / extend_reservation_stay 的共用設定與錯誤對照。
 * migration 還沒套用時（表或函式不存在），API 退回舊流程，所以先後順序不會讓結帳壞掉。
 */

export const PAYMENT_METHODS = [
  { value: "cash", label: "現金" },
  { value: "card", label: "刷卡" },
  { value: "line_pay", label: "LINE Pay" },
  { value: "transfer", label: "轉帳" },
  { value: "other", label: "其他" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

/** 可以打折的角色（和 settle_reservation_checkout 裡的檢查一致） */
export const DISCOUNT_ROLES = ["owner", "branch_manager"] as const;

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.some((method) => method.value === value);
}

type DbError = { code?: string; message?: string } | null | undefined;

/** 表或函式還不存在 = migration 尚未套用 */
export function isSettlementSchemaMissing(error: DbError): boolean {
  return Boolean(error && ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? ""));
}

const MESSAGES: Record<string, string> = {
  stale_end_time: "這組剛剛被別人改過，請重新整理再試一次",
  not_checked_in: "客人到了以後才能改時間",
  end_before_start: "結束時間要比開始時間晚",
  no_change: "時間沒有變",
  not_whole_minutes: "時間請選到整分鐘",
  amount_changed: "金額剛剛有變動，請再確認一次",
  already_settled: "這組已經結過帳了，請重新整理看結果",
  not_arrived: "客人到了以後才能結帳",
  nothing_to_settle: "這組沒有要收的餐費",
  discount_not_allowed: "只有老闆或店長可以打折",
  discount_reason_required: "打折要填原因",
  discount_too_large: "折扣不能比要收的金額多",
  invalid_discount: "折扣金額不對",
  collected_mismatch: "實收金額和應收對不上，請重新確認",
  payment_method_required: "請選付款方式",
  reservation_not_found: "找不到訂位",
};

/** RPC 丟出的代碼 → 給店員看的中文與 HTTP 狀態；不認得的回 null（交給外層當 500） */
export function settlementFailure(error: DbError): { status: number; error: string } | null {
  if (!error) return null;
  if (error.code === "23P01") return { status: 409, error: "會跟這間的其他客人時間重疊，請換包廂或先問問對方" };
  if (error.code === "23505") return { status: 409, error: MESSAGES.already_settled };
  const message = MESSAGES[(error.message ?? "").trim()];
  if (!message) return null;
  return { status: error.message === "reservation_not_found" ? 404 : 409, error: message };
}
