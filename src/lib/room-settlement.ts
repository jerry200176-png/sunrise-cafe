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

/**
 * 打折、退錢只限老闆／店長，而且只能處理自己分店的訂位。角色與分店一律來自登入 session。
 * 店長沒有分店清單（branch_ids = null）不算全分店，一律拒絕（和 SQL can_adjust_reservation_money 一致）。
 */
export function canAdjustMoney(
  role: string | null | undefined,
  hasBranchAccess: boolean,
  branchIds: string[] | null
): boolean {
  if (!hasBranchAccess || !(DISCOUNT_ROLES as readonly string[]).includes(role ?? "")) return false;
  return role !== "branch_manager" || Array.isArray(branchIds);
}

/**
 * 傳給 SQL 的操作者身分：全部取自登入 session（ctx），SQL 會再用 can_adjust_reservation_money 檢查一次。
 * branch_ids 為 null = 不限分店（只有老闆會是這樣；店長是 null 時 SQL 一律拒絕）。
 */
export function moneyActor(ctx: { user_id: string | null; role: string; branch_ids: string[] | null }) {
  return { p_actor: ctx.user_id ?? ctx.role ?? null, p_actor_role: ctx.role ?? null, p_actor_branch_ids: ctx.branch_ids ?? null };
}

/**
 * 現金找零（Founder D6）：一般員工可以做，但只限「現金結帳、這次有收錢」。
 * 找零 = 客人付的現金 − 這次要收的金額（伺服器算，前端不能指定），所以永遠不會超過「付的現金 − 帳單」。
 * 找零不是退款：要退訂金差額（refund > 0）時不能帶找零；退款與打折照各自的權限（老闆／本分店店長）。
 * 和 SQL settle_reservation_checkout 的檢查一致。tendered 為 undefined／null = 沒有找零紀錄。
 */
/** 客人給的現金上限（整數元）。超過一定是輸錯；也避免超過資料庫 integer 範圍變成 500。和 SQL 的 CHECK 一致。 */
export const MAX_CASH_TENDERED = 100_000;

export type CashChangeProblem = "invalid_cash_tendered" | "change_cash_only" | "change_not_refund" | "cash_tendered_short"
  | "cash_tendered_required";
export function cashChange(input: { tendered: unknown; method: string | null | undefined; collected: number; refund: number }):
  { change: number | null } | { problem: CashChangeProblem } {
  if (input.tendered === undefined || input.tendered === null) {
    // 現金、有要收的錢（不是純退款）：客人給的現金必填（Founder A6-7）
    return input.method === "cash" && input.collected > 0 && input.refund <= 0
      ? { problem: "cash_tendered_required" } : { change: null };
  }
  if (typeof input.tendered !== "number" || !Number.isInteger(input.tendered) || input.tendered <= 0
    || input.tendered > MAX_CASH_TENDERED) {
    return { problem: "invalid_cash_tendered" };
  }
  if (input.refund > 0) return { problem: "change_not_refund" };
  if (input.method !== "cash") return { problem: "change_cash_only" };
  if (input.collected <= 0) return { problem: "change_not_refund" };
  if (input.tendered < input.collected) return { problem: "cash_tendered_short" };
  return { change: input.tendered - input.collected };
}

export type RefundStatus = "requested" | "pending" | "succeeded" | "failed" | "canceled";
export type RefundLedgerRow = { kind: string; amount: number; status: string };

/**
 * 訂金「真的已退」多少、有沒有還在處理中的退款（和 SQL reservation_deposit_refunded／reservation_refund_in_flight 同規則）：
 * - 只有 succeeded 算已退；部分退款只算實際退的金額
 * - requested／pending 不算已退，但結果未定 → inFlight，結帳要先擋下
 * - 帳本沒有訂金退款、但 deposit_status = refunded（舊的全額 Stripe 退款）→ 全額已退
 */
export function summarizeDepositRefunds(rows: RefundLedgerRow[] | null, depositStatus: string | null | undefined):
  { refunded: number; inFlight: boolean } {
  const deposit = (rows ?? []).filter((row) => row.kind === "deposit");
  if (!deposit.length) return { refunded: depositStatus === "refunded" ? Number.POSITIVE_INFINITY : 0, inFlight: false };
  return {
    refunded: deposit.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + Number(row.amount), 0),
    inFlight: deposit.some((row) => row.status === "requested" || row.status === "pending"),
  };
}

/** Stripe Refund.status → 退款帳本狀態。不認得的一律當處理中（絕不當成已退）。 */
export function stripeRefundStatus(status: string | null | undefined): Exclude<RefundStatus, "requested"> {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "pending";
}

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
  refund_not_allowed: "退錢要請老闆或店長操作",
  discount_reason_required: "打折要填原因",
  discount_too_large: "折扣不能比要收的金額多",
  invalid_discount: "折扣金額不對",
  collected_mismatch: "實收金額和應收對不上，請重新確認",
  payment_method_required: "請選付款方式",
  reservation_not_found: "找不到訂位",
  refund_in_flight: "這組有一筆退款還在處理中，等退款結果出來再結帳",
  nothing_to_refund: "這組沒有可以退的金額（訂金已退過或已在結帳時折抵）",
  refund_exceeds_refundable: "退款金額超過可退的金額",
  idempotency_conflict: "這次退款和剛剛送出的不一樣，請重新整理再試",
  idempotency_key_required: "退款請求缺少識別碼，請重新整理再試",
  invalid_refund_transition: "這筆退款目前的狀態不能這樣改",
  provider_outcome_only: "Stripe 退款的結果要等 Stripe 回報，不能手動標記",
  refund_reason_required: "退款要填原因",
  invalid_refund_method: "退款方式不對",
  invalid_refund_amount: "退款金額不對",
  invalid_refund_kind: "退款類型不對",
  refund_not_found: "找不到這筆退款",
  refund_ledger_append_only: "退款紀錄不能修改或刪除",
  refund_evidence_required: "標成「已退」要附證據：轉帳序號（或交易編號）和說明；現金退款要寫是誰、何時交給客人",
  invalid_refund_reference: "證據編號格式不對：請填實際的轉帳序號／交易編號（格式見畫面說明），不能只寫文字",
  cash_handback_required: "現金退款要等現金真的交還客人，並勾選「已交還」才算完成",
  refund_failure_evidence_required: "已退改成失敗，要附上退回或失敗的交易編號和原因",
  legacy_refund_status_unverified: "這筆是舊資料標成「訂金已退」，要等盤點核對後才能再處理",
  alert_not_found: "找不到這個警示",
  alert_note_required: "認領警示要寫說明（打算怎麼處理）",
  invalid_cash_tendered: "客人付的現金金額不對（最多 NT$ 100,000）",
  change_actor_required: "找零要記下是誰操作的，請重新登入再試",
  change_cash_only: "只有現金結帳才有找零",
  change_not_refund: "找零不能用來退錢；要退訂金請老闆或店長走退款",
  cash_tendered_short: "客人付的現金比要收的少",
  cash_tendered_required: "現金結帳要填客人實際給了多少",
};

/** 找零檢查不過時給店員看的中文 */
export function cashChangeMessage(problem: CashChangeProblem): string {
  return MESSAGES[problem];
}

const NOT_FOUND = new Set(["reservation_not_found", "refund_not_found", "alert_not_found"]);

/** RPC 丟出的代碼 → 給店員看的中文與 HTTP 狀態；不認得的回 null（交給外層當 500） */
export function settlementFailure(error: DbError): { status: number; error: string } | null {
  if (!error) return null;
  if (error.code === "23P01") return { status: 409, error: "會跟這間的其他客人時間重疊，請換包廂或先問問對方" };
  if (error.code === "23505") return { status: 409, error: MESSAGES.already_settled };
  const message = MESSAGES[(error.message ?? "").trim()];
  if (!message) return null;
  return { status: NOT_FOUND.has((error.message ?? "").trim()) ? 404 : 409, error: message };
}
