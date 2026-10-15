import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAdminContext, requireAdminApiAuth } from "@/lib/admin-api-auth";
import { canAccessBranch } from "@/lib/rbac";
import { logOps } from "@/lib/ops-log";
import { canAdjustMoney, isSettlementSchemaMissing, moneyActor, settlementFailure } from "@/lib/room-settlement";
import { capturedRemaining, driveStripeRefund, isDepositFullyRefunded, type RefundLedgerResult } from "@/lib/refund-ledger";
import { MANUAL_REFUND_STATUSES, manualRefundProblem } from "@/lib/refund-actions";

/**
 * 退款（#444 退款帳本）。退款原則（Founder 2026-10-15）：
 *  1. 已退的訂金不能再折抵帳單 → 由 SQL 用訂位鎖＋可退上限保證
 *  2. 只有老闆或本分店店長能退；角色與分店取自登入 session，SQL 再檢查一次
 *  3. 部分退款只扣實際退的金額
 *  4. 失敗或處理中的退款不算已退 → 只有 Stripe 回報 succeeded（或店長確認人工退款）才算
 *  5. 每筆退款都寫進只能新增的帳本（誰、何時、多少、原因、狀態、哪筆訂位），用冪等鍵防重送
 *
 * POST  { reservationId, reason, amount?, idempotencyKey?, method? }
 *   有 Stripe 付款 → 經 Stripe 退款；沒有 → 記一筆人工退款（method：cash／transfer／line_pay／card／other），狀態 requested
 * PATCH { refundId, status: "pending" | "succeeded" | "failed" | "canceled", note?, reference? }
 *   確認人工退款的結果（Founder D7）：標成功要有證據（非現金 = reference 轉帳序號／交易編號＋note；現金 = note），
 *   標失敗／取消要寫原因（note）。Stripe 退款的任何結果（含取消）只能由 Stripe 回報或對帳決定
 * PATCH { refundId, reconcile: true }
 *   Stripe 退款對帳：向 Stripe 查這筆帳本的退款並同步；23 小時內查不到就用同一個冪等鍵重送，
 *   超過 23 小時且 Stripe 確認沒有 → 記 canceled（之後才可以重新申請）
 * GET  ?reservationId=  這筆訂位的退款、每一步事件、訂金狀態與警示
 * GET  ?view=open       還沒結束（requested／pending）的退款清單＋最近警示；不帶 = 最近的退款警示（店長只看自己分店）
 *
 * 金額：帳本、請求、回應都是整數元；和 Stripe 往來在 refund-ledger／stripe-money 換算（TWD ×100），
 * 可退金額不超過 Stripe 那筆付款實際收到且還沒退的金額。
 */

const MANUAL_METHODS = ["cash", "card", "line_pay", "transfer", "other"] as const;

function failure(error: { code?: string; message?: string } | null | undefined) {
  if (isSettlementSchemaMissing(error)) {
    return NextResponse.json({ error: "退款帳本還沒啟用（migration 尚未套用），暫時不能退款" }, { status: 503 });
  }
  const mapped = settlementFailure(error);
  return mapped ? NextResponse.json({ error: mapped.error }, { status: mapped.status }) : null;
}

/** 依訂位的分店檢查角色（只看 session）。回傳錯誤回應或 null。 */
type GuardedReservation = { id: string; payment_intent_id: string | null; deposit_status: string | null; booking_code: string | null };
async function guard(request: NextRequest, reservationId: string):
  Promise<{ denied: NextResponse } | { ctx: Awaited<ReturnType<typeof getAdminContext>>; reservation: GuardedReservation }> {
  const authDenied = await requireAdminApiAuth(request);
  if (authDenied) return { denied: authDenied };
  const ctx = await getAdminContext(request);
  const { data: reservation, error } = await supabaseAdmin()
    .from("reservations")
    .select("id, payment_intent_id, deposit_status, booking_code, room:rooms(branch_id)")
    .eq("id", reservationId)
    .maybeSingle();
  if (error) throw error;
  if (!reservation) return { denied: NextResponse.json({ error: "預約不存在" }, { status: 404 }) };
  const room = Array.isArray(reservation.room) ? reservation.room[0] : reservation.room;
  const branchId = (room as { branch_id?: string } | null)?.branch_id ?? null;
  if (!canAdjustMoney(ctx.role, canAccessBranch(ctx, branchId), ctx.branch_ids)) {
    return { denied: NextResponse.json({ error: "退款要請老闆或這間分店的店長操作" }, { status: 403 }) };
  }
  return { ctx, reservation: reservation as GuardedReservation };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      reservationId?: string; reason?: string; amount?: number; idempotencyKey?: string; method?: string;
    };
    if (!body.reservationId) return NextResponse.json({ error: "缺少必填欄位（reservationId）" }, { status: 400 });
    if (!body.reason?.trim()) return NextResponse.json({ error: "退款要填原因" }, { status: 400 });
    if (body.amount != null && (!Number.isInteger(body.amount) || body.amount <= 0)) {
      return NextResponse.json({ error: "退款金額不對" }, { status: 400 });
    }
    const checked = await guard(request, body.reservationId);
    if ("denied" in checked) return checked.denied;
    const { ctx, reservation } = checked;

    const viaStripe = Boolean(reservation.payment_intent_id);
    if (viaStripe && !isStripeEnabled()) return NextResponse.json({ error: "Stripe 支付尚未啟用" }, { status: 503 });
    const method = viaStripe ? "stripe" : body.method;
    if (!viaStripe && !(MANUAL_METHODS as readonly string[]).includes(method ?? "")) {
      return NextResponse.json({ error: "請選退款方式" }, { status: 400 });
    }

    // 0) Stripe 付款：可退金額不超過 Stripe 實際收到、還沒退掉的金額（整數元）
    let providerCap: number | null = null;
    if (viaStripe) {
      try {
        const intent = await stripe!.paymentIntents.retrieve(reservation.payment_intent_id as string, { expand: ["latest_charge"] });
        const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
        providerCap = capturedRemaining(charge);
      } catch (err) {
        logOps("payment", "payment.refund_provider_error", {
          reservation_id: reservation.id, stage: "retrieve_intent", error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: "讀不到 Stripe 付款資料，請稍後再試" }, { status: 502 });
      }
    }

    // 1) 先記帳本（requested）：鎖訂位、檢查可退上限與角色。同一個冪等鍵重送會拿回同一筆
    const requested = await supabaseAdmin().rpc("request_reservation_refund", {
      p_reservation_id: reservation.id,
      p_kind: "deposit",
      p_amount: body.amount ?? null,
      p_method: method,
      p_reason: body.reason.trim(),
      p_idempotency_key: body.idempotencyKey?.trim() || `refund:${randomUUID()}`,
      ...moneyActor(ctx),
      p_provider_cap: providerCap,
    });
    if (requested.error) {
      const response = failure(requested.error);
      if (response) return response;
      throw requested.error;
    }
    let ledger = requested.data as RefundLedgerResult;

    if (viaStripe && ledger.status === "requested") {
      const outcome = await drive(ledger, reservation.payment_intent_id as string, reservation.id, reservation.booking_code);
      if ("response" in outcome) return outcome.response;
      ledger = outcome.ledger;
    }

    logOps("payment", "payment.refund_recorded", {
      reservation_id: reservation.id, booking_code: reservation.booking_code, refund_id: ledger.id,
      amount: ledger.amount, method, status: ledger.status, actor: ctx.user_id ?? ctx.role,
    });
    return NextResponse.json({ ok: true, refundId: ledger.id, amount: ledger.amount, status: ledger.status });
  } catch (err) {
    console.error("[refund] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "退款失敗" }, { status: 500 });
  }
}

/**
 * 推進／對帳一筆 Stripe 退款。Stripe 結果不明（網路錯誤）時帳本留在 requested：不算已退、也擋著結帳，
 * 之後再按一次或用 PATCH reconcile 對帳。店長不能把它取消。
 */
async function drive(ledger: RefundLedgerResult, paymentIntentId: string, reservationId: string, bookingCode: string | null):
  Promise<{ ledger: RefundLedgerResult } | { response: NextResponse }> {
  try {
    const outcome = await driveStripeRefund(supabaseAdmin(), stripe!.refunds as never,
      { ...ledger, created_at: ledger.created_at ?? new Date().toISOString() }, paymentIntentId, { reservationId, bookingCode });
    const next = outcome && "id" in outcome ? outcome : ledger;
    if (isDepositFullyRefunded(next)) {
      await supabaseAdmin().from("payment_intents").update({ status: "refunded", updated_at: new Date().toISOString() })
        .eq("stripe_pi_id", paymentIntentId);
    }
    return { ledger: next };
  } catch (err) {
    logOps("payment", "payment.refund_provider_error", {
      reservation_id: reservationId, refund_id: ledger.id, error: err instanceof Error ? err.message : String(err),
    });
    return { response: NextResponse.json({ error: "Stripe 還沒回覆退款結果，請稍後重新整理或再按一次（不會重複退）", refundId: ledger.id,
      status: ledger.status }, { status: 502 }) };
  }
}

export async function GET(request: NextRequest) {
  try {
    const authDenied = await requireAdminApiAuth(request);
    if (authDenied) return authDenied;
    const ctx = await getAdminContext(request);
    if (!["owner", "branch_manager"].includes(ctx.role) || (ctx.role === "branch_manager" && !Array.isArray(ctx.branch_ids))) {
      return NextResponse.json({ error: "退款紀錄只有老闆或店長可以看" }, { status: 403 });
    }
    const reservationId = request.nextUrl.searchParams.get("reservationId");
    if (reservationId) {
      const checked = await guard(request, reservationId);
      if ("denied" in checked) return checked.denied;
      const [refunds, alerts, state] = await Promise.all([
        supabaseAdmin().from("reservation_refund_current").select("*").eq("reservation_id", reservationId).order("created_at"),
        supabaseAdmin().from("reservation_refund_alerts").select("*").eq("reservation_id", reservationId).order("created_at"),
        supabaseAdmin().rpc("reservation_billing_state", { p_reservation_id: reservationId }),
      ]);
      const error = refunds.error ?? alerts.error ?? state.error;
      if (error) return failure(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
      const ids = ((refunds.data ?? []) as Array<{ id: string }>).map((row) => row.id);
      const events = ids.length
        ? await supabaseAdmin().from("reservation_refund_events").select("*").in("refund_id", ids).order("seq")
        : { data: [], error: null };
      if (events.error) return failure(events.error) ?? NextResponse.json({ error: events.error.message }, { status: 500 });
      const { reservation } = checked;
      return NextResponse.json({
        reservation: { id: reservation.id, booking_code: reservation.booking_code, deposit_status: reservation.deposit_status,
          via_stripe: Boolean(reservation.payment_intent_id) },
        billing: state.data, refunds: refunds.data, events: events.data, alerts: alerts.data,
      });
    }
    if (request.nextUrl.searchParams.get("view") === "open") return openRefunds(ctx);
    let query = supabaseAdmin().from("reservation_refund_alerts").select("*").order("created_at", { ascending: false }).limit(100);
    if (ctx.branch_ids !== null) query = query.in("branch_id", ctx.branch_ids);
    const alerts = await query;
    if (alerts.error) return failure(alerts.error) ?? NextResponse.json({ error: alerts.error.message }, { status: 500 });
    return NextResponse.json({ alerts: alerts.data });
  } catch (err) {
    console.error("[refund] list error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "讀取退款紀錄失敗" }, { status: 500 });
  }
}

/** 還沒結束的退款（老闆看全部，店長只看自己分店）＋訂位資訊＋最近警示 */
async function openRefunds(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  let refunds = supabaseAdmin().from("reservation_refund_current").select("*").in("status", ["requested", "pending"])
    .order("created_at").limit(200);
  let alerts = supabaseAdmin().from("reservation_refund_alerts").select("*").order("created_at", { ascending: false }).limit(50);
  if (ctx.branch_ids !== null) {
    refunds = refunds.in("branch_id", ctx.branch_ids);
    alerts = alerts.in("branch_id", ctx.branch_ids);
  }
  const [open, recent] = await Promise.all([refunds, alerts]);
  const error = open.error ?? recent.error;
  if (error) return failure(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (open.data ?? []) as Array<{ reservation_id: string }>;
  const ids = [...new Set(rows.map((row) => row.reservation_id))];
  const reservations = ids.length
    ? await supabaseAdmin().from("reservations").select("id, booking_code, customer_name, start_time, status").in("id", ids)
    : { data: [], error: null };
  if (reservations.error) throw reservations.error;
  const byId = new Map(((reservations.data ?? []) as Array<{ id: string }>).map((row) => [row.id, row]));
  return NextResponse.json({ refunds: rows.map((row) => ({ ...row, reservation: byId.get(row.reservation_id) ?? null })), alerts: recent.data });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { refundId?: string; status?: string; note?: string; reference?: string; reconcile?: boolean };
    if (body.refundId && body.reconcile === true) return reconcile(request, body.refundId);
    if (!body.refundId || !body.status) return NextResponse.json({ error: "缺少必填欄位（refundId, status）" }, { status: 400 });
    if (!(MANUAL_REFUND_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: "退款狀態不對" }, { status: 400 });
    }
    const { data: row, error } = await supabaseAdmin().from("reservation_refund_current").select("id, reservation_id, method, status")
      .eq("id", body.refundId).maybeSingle();
    if (error) {
      const response = failure(error);
      if (response) return response;
      throw error;
    }
    if (!row) return NextResponse.json({ error: "找不到這筆退款" }, { status: 404 });
    const checked = await guard(request, row.reservation_id as string);
    if ("denied" in checked) return checked.denied;
    const { ctx } = checked;
    // D7：不能為了解除「處理中」就直接標成功；證據／原因先在這裡擋一次，SQL 會再檢查一次
    if (row.status !== body.status) {
      const problem = manualRefundProblem({ method: row.method as string, from: row.status as string, to: body.status,
        note: body.note, reference: body.reference });
      if (problem) {
        const mapped = settlementFailure({ message: problem });
        return NextResponse.json({ error: mapped?.error ?? problem }, { status: problem === "invalid_refund_transition" ? 409 : 400 });
      }
    }
    const result = await supabaseAdmin().rpc("record_reservation_refund_status", {
      p_refund_id: row.id,
      p_status: body.status,
      p_provider_ref: null,
      p_note: body.note?.trim() || null,
      ...moneyActor(ctx),
      p_evidence_ref: body.reference?.trim() || null,
    });
    if (result.error) {
      const response = failure(result.error);
      if (response) return response;
      throw result.error;
    }
    const ledger = result.data as RefundLedgerResult;
    logOps("payment", "payment.refund_status_recorded", {
      reservation_id: ledger.reservation_id, refund_id: ledger.id, status: ledger.status, actor: ctx.user_id ?? ctx.role,
      has_evidence: Boolean(body.reference?.trim()),
    });
    return NextResponse.json({ ok: true, refundId: ledger.id, status: ledger.status });
  } catch (err) {
    console.error("[refund] status error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "更新退款狀態失敗" }, { status: 500 });
  }
}

/** Stripe 退款對帳：只有老闆／本分店店長能觸發；結果由 Stripe 決定，不由觸發的人決定 */
async function reconcile(request: NextRequest, refundId: string): Promise<NextResponse> {
  const { data: row, error } = await supabaseAdmin().from("reservation_refund_current")
    .select("id, reservation_id, kind, amount, method, status, created_at").eq("id", refundId).maybeSingle();
  if (error) return failure(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "找不到這筆退款" }, { status: 404 });
  const checked = await guard(request, row.reservation_id as string);
  if ("denied" in checked) return checked.denied;
  const { reservation } = checked;
  if (row.method !== "stripe" || !reservation.payment_intent_id) {
    return NextResponse.json({ error: "只有 Stripe 退款需要對帳" }, { status: 400 });
  }
  if (!isStripeEnabled()) return NextResponse.json({ error: "Stripe 支付尚未啟用" }, { status: 503 });
  if (!["requested", "pending"].includes(row.status as string)) {
    return NextResponse.json({ ok: true, refundId: row.id, status: row.status });
  }
  const ledger = { ...(row as unknown as RefundLedgerResult), deposit_gross: 0, deposit_refunded: 0 };
  const outcome = await drive(ledger, reservation.payment_intent_id as string, reservation.id as string, reservation.booking_code);
  if ("response" in outcome) return outcome.response;
  logOps("payment", "payment.refund_status_recorded", { reservation_id: reservation.id, refund_id: row.id,
    status: outcome.ledger.status, actor: "reconcile" });
  return NextResponse.json({ ok: true, refundId: outcome.ledger.id, status: outcome.ledger.status });
}
