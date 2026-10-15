/**
 * 退款帳本（#444）：Stripe 退款結果同步到 reservation_refunds／reservation_refund_events。
 * 帳本只能新增；狀態只有 succeeded 才算真的退了（見 docs/PAYMENT_STATE_MODEL.md「退款」）。
 * 金額：帳本一律整數元；和 Stripe 往來一律經過 stripe-money 換算（TWD ×100）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSettlementSchemaMissing, stripeRefundStatus } from "@/lib/room-settlement";
import { STRIPE_CURRENCY, fromStripeAmount, toStripeAmount } from "@/lib/stripe-money";

export type StripeRefundLike = {
  id: string;
  status?: string | null;
  /** Stripe 單位（TWD ×100） */
  amount: number;
  currency?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

export type RefundLedgerResult = {
  id: string;
  reservation_id: string;
  kind: string;
  amount: number;
  status: string;
  created_at?: string;
  deposit_gross: number;
  deposit_refunded: number;
};

/** 同一筆退款請求只在這段時間內重送給 Stripe（Stripe 的冪等鍵保留 24 小時，留 1 小時餘裕） */
export const STRIPE_REDRIVE_WINDOW_MS = 23 * 60 * 60 * 1000;

/** 重送或延遲的舊事件（例如已 succeeded 之後才到的 pending）：記 log、回 200，不讓 webhook 500 重試 */
const STALE_CODES = new Set(["invalid_refund_transition"]);

/** Stripe 冪等鍵：一定包含帳本那一列的 id，同一筆帳本請求怎麼重送都只會在 Stripe 退一次 */
export const stripeRefundIdempotencyKey = (ledgerId: string) => `ledger_refund_${ledgerId}`;

const piId = (refund: StripeRefundLike) =>
  typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;

export type SyncOutcome = RefundLedgerResult | { schemaMissing: true } | { ignored: string } | null;

/**
 * 把一筆 Stripe 退款的目前狀態寫進帳本（重送同一狀態不會多記；過期的狀態變化會被忽略）。
 * 回傳 null = 找不到對應訂位（不是我們的退款）。
 */
export async function syncStripeRefund(db: SupabaseClient, refund: StripeRefundLike): Promise<SyncOutcome> {
  let reservationId = refund.metadata?.reservationId || null;
  const paymentIntent = piId(refund);
  if (!reservationId && paymentIntent) {
    const { data } = await db.from("payment_intents").select("reservation_id").eq("stripe_pi_id", paymentIntent).maybeSingle();
    reservationId = (data?.reservation_id as string | undefined) ?? null;
  }
  if (!reservationId) return null;
  const result = await db.rpc("sync_provider_refund", {
    p_reservation_id: reservationId,
    p_ledger_refund_id: refund.metadata?.refund_ledger_id || null,
    p_provider_ref: refund.id,
    p_amount: fromStripeAmount(refund.amount, refund.currency ?? STRIPE_CURRENCY),
    p_status: stripeRefundStatus(refund.status),
  });
  if (result.error) {
    if (isSettlementSchemaMissing(result.error)) return { schemaMissing: true };
    const code = (result.error.message ?? "").trim();
    if (STALE_CODES.has(code)) return { ignored: code };
    if (code === "refund_reservation_mismatch") {
      // 退款的 metadata 指向別筆訂位：不是過期事件，是資料不一致。留警示讓老闆／店長看到，並讓 webhook 500（Stripe 會重送、log 也看得到）
      const alert = await db.from("reservation_refund_alerts").insert({
        reservation_id: reservationId,
        refund_id: null,
        kind: "provider_reservation_mismatch",
        detail: { provider_ref: refund.id, ledger_refund_id: refund.metadata?.refund_ledger_id ?? null, payment_intent: paymentIntent },
      });
      if (alert.error) console.error("[refund-ledger] mismatch alert insert failed", alert.error.message);
    }
    throw result.error;
  }
  return result.data as RefundLedgerResult;
}

/** 訂金已經全額真的退掉（只看 succeeded） */
export function isDepositFullyRefunded(result: Pick<RefundLedgerResult, "deposit_gross" | "deposit_refunded">): boolean {
  return result.deposit_gross > 0 && result.deposit_refunded >= result.deposit_gross;
}

/** 這筆付款在 Stripe 實際收到、還沒退掉的金額（整數元）。讀不到就回 0（不能退）。 */
export function capturedRemaining(charge: { amount_captured?: number | null; amount_refunded?: number | null;
  currency?: string | null } | null | undefined): number {
  if (!charge) return 0;
  const left = Number(charge.amount_captured ?? 0) - Number(charge.amount_refunded ?? 0);
  return Math.max(0, fromStripeAmount(left, charge.currency ?? STRIPE_CURRENCY));
}

type StripeRefundsApi = {
  list(params: { payment_intent: string; limit: number; starting_after?: string }):
    Promise<{ data: StripeRefundLike[]; has_more?: boolean }>;
  retrieve?(id: string): Promise<StripeRefundLike>;
  create(params: Record<string, unknown>, options: { idempotencyKey: string }): Promise<StripeRefundLike>;
};

/** 對帳一次最多翻幾頁（每頁 100 筆）；超過就當「查不完整」，不能當成「沒有」 */
export const STRIPE_REFUND_LIST_MAX_PAGES = 20;

export type UnknownOutcome = { unknown: true; reason: string; alertId: string | null };
export type DriveOutcome = SyncOutcome | UnknownOutcome;

/** 這筆付款在 Stripe 的所有退款（翻完每一頁）。翻不完回 null（= 查不完整）。 */
export async function listAllStripeRefunds(refunds: StripeRefundsApi, paymentIntentId: string): Promise<StripeRefundLike[] | null> {
  const all: StripeRefundLike[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < STRIPE_REFUND_LIST_MAX_PAGES; page += 1) {
    const result = await refunds.list({ payment_intent: paymentIntentId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    all.push(...result.data);
    if (!result.has_more || result.data.length === 0) return all;
    startingAfter = result.data[result.data.length - 1].id;
  }
  return null;
}

/**
 * 推進／對帳一筆 requested／pending 的 Stripe 退款（新請求、重送、對帳都走這裡）。Founder A6-6：
 *  1. 完整查詢：翻完這筆付款在 Stripe 的每一頁退款，找 metadata.refund_ledger_id = 這筆帳本；
 *     帳本上已知的 Stripe 退款編號（provider_ref）也逐一直接查。找到 → 照 Stripe 的狀態同步
 *  2. 找不到、請求還在 23 小時內 → 用含帳本 id 的冪等鍵建立（重送也不會退兩次）
 *  3. 找不到、超過 23 小時，或查詢不完整 → 「結果不明，需要人工對帳」：
 *     不取消、不解鎖（帳本維持處理中，結帳仍擋著），開一個需要有人認領的 provider_outcome_unknown 警示。
 *     23 小時查不到不代表沒有退款。
 * 店長／老闆永遠不能自己改 Stripe 退款的狀態（SQL 會擋）。
 */
export async function driveStripeRefund(
  db: SupabaseClient,
  refunds: StripeRefundsApi,
  ledger: RefundLedgerResult & { created_at: string },
  paymentIntentId: string,
  meta: { reservationId: string; bookingCode?: string | null },
  now: number = Date.now()
): Promise<DriveOutcome> {
  const listed = await listAllStripeRefunds(refunds, paymentIntentId);
  const found = listed?.find((refund) => refund.metadata?.refund_ledger_id === ledger.id);
  if (found) return syncStripeRefund(db, found);

  // 帳本上已經記過的 Stripe 退款編號：直接查（不靠列表）
  const known = await db.from("reservation_refund_events").select("provider_ref").eq("refund_id", ledger.id);
  if (known.error) {
    if (isSettlementSchemaMissing(known.error)) return { schemaMissing: true };
    throw known.error;
  }
  const refs = [...new Set(((known.data ?? []) as Array<{ provider_ref: string | null }>).map((row) => row.provider_ref)
    .filter((ref): ref is string => Boolean(ref)))];
  for (const ref of refs) {
    if (!refunds.retrieve) break;
    const refund = await refunds.retrieve(ref);
    if (refund) return syncStripeRefund(db, refund);
  }

  if (listed !== null && refs.length === 0 && now - new Date(ledger.created_at).getTime() < STRIPE_REDRIVE_WINDOW_MS) {
    const created = await refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: toStripeAmount(ledger.amount, STRIPE_CURRENCY),
        reason: "requested_by_customer",
        metadata: { refund_ledger_id: ledger.id, reservationId: meta.reservationId, bookingCode: meta.bookingCode ?? "" },
      },
      { idempotencyKey: stripeRefundIdempotencyKey(ledger.id) }
    );
    return syncStripeRefund(db, created);
  }

  const reason = listed === null ? "stripe_refund_list_incomplete"
    : refs.length ? "known_refund_ids_not_found" : "not_found_after_redrive_window";
  const alert = await db.rpc("raise_refund_alert", {
    p_refund_id: ledger.id,
    p_kind: "provider_outcome_unknown",
    p_detail: { reason, payment_intent: paymentIntentId, listed: listed?.length ?? null, known_refund_ids: refs,
      ledger_created_at: ledger.created_at },
  });
  if (alert.error) {
    if (isSettlementSchemaMissing(alert.error)) return { schemaMissing: true };
    throw alert.error;
  }
  return { unknown: true, reason, alertId: (alert.data as string | null) ?? null };
}
