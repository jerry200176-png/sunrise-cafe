import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAdminContext, requireAdminApiAuth } from "@/lib/admin-api-auth";
import { canAccessBranch, type AdminContext } from "@/lib/rbac";
import { logOps } from "@/lib/ops-log";
import { canAdjustMoney, isSettlementSchemaMissing, moneyActor, settlementFailure } from "@/lib/room-settlement";
import { capturedRemaining, driveStripeRefund, isDepositFullyRefunded, type RefundLedgerResult } from "@/lib/refund-ledger";
import { MANUAL_REFUND_STATUSES, manualRefundProblem, refundReferenceValid } from "@/lib/refund-actions";

/**
 * 退款（#444 退款帳本）。退款原則（Founder 2026-10-15）與 A6 決定：
 *  1. 已退的訂金不能再折抵帳單 → 由 SQL 用訂位鎖＋可退上限保證
 *  2. 只有老闆或本分店店長能退；角色與分店取自登入 session，SQL 再檢查一次。finance 只能看（A6-1）
 *  3. 部分退款只扣實際退的金額
 *  4. 失敗或處理中的退款不算已退 → 只有 Stripe 回報 succeeded（或有證據的人工確認）才算
 *  5. 每筆退款都寫進只能新增的帳本（誰、何時、多少、原因、狀態、哪筆訂位），用冪等鍵防重送
 *
 * POST  { reservationId, reason, amount?, idempotencyKey?, method?, kind? }
 *   有 Stripe 付款的訂金 → 經 Stripe 退款；其他 → 記一筆人工退款（requested）。
 *   kind = checkout_deposit_excess：補申請結帳時欠客人的訂金差額（只限人工方式，A6-9）
 * POST  { reservationId, offSystem: true, amount, method, reason, reference?, cashHandedBack?, idempotencyKey }
 *   系統外退款補登（A6-2）：人工核對並實際退款後補記，要原因＋格式正確的交易編號（現金要確認已交還），留稽核警示
 * PATCH { refundId, status, note?, reference?, cashHandedBack? }
 *   記人工退款的結果：已退要證據（A6-8 格式驗證；現金要確認已交還 A6-3）；失敗／取消要原因；
 *   已退改失敗要有退回的證據編號（A6-9）。Stripe 退款的任何結果只能由 Stripe 回報或對帳決定
 * PATCH { refundId, reconcile: true }
 *   Stripe 對帳（A6-6）：完整查詢（翻完每一頁、直接查已知退款編號）。查不到又超過重送期限 → 不取消、不解鎖，
 *   維持處理中並開一個需要認領的「結果不明」警示
 * PATCH { alertId, acknowledge: true, note }  認領警示（A6-4）
 * GET  ?reservationId=   這筆訂位的退款、每一步事件、訂金狀態、欠款與警示
 * GET  ?view=open        還沒結束的退款、欠客人的訂金差額、還沒有人認領的警示
 * GET  ?view=ledger      最近的退款帳本（含已結束的）
 * GET                    最近的警示（含認領狀態）；?open=1 只看還沒有人認領的
 * 讀取：老闆、店長（自己分店）、finance（唯讀稽核）。寫入：老闆或本分店店長。
 */

const MANUAL_METHODS = ["cash", "card", "line_pay", "transfer", "other"] as const;
type Ctx = Awaited<ReturnType<typeof getAdminContext>>;

function failure(error: { code?: string; message?: string } | null | undefined) {
  if (isSettlementSchemaMissing(error)) {
    return NextResponse.json({ error: "退款帳本還沒啟用（migration 尚未套用），暫時不能退款" }, { status: 503 });
  }
  const mapped = settlementFailure(error);
  return mapped ? NextResponse.json({ error: mapped.error }, { status: mapped.status }) : null;
}

/** 能看退款紀錄：老闆、有分店清單的店長、finance（唯讀稽核，A6-1） */
function canReadRefunds(ctx: AdminContext): boolean {
  if (ctx.role === "owner" || ctx.role === "finance") return true;
  return ctx.role === "branch_manager" && Array.isArray(ctx.branch_ids);
}
const viewer = (ctx: AdminContext, branchId: string | null) =>
  ({ role: ctx.role, can_act: canAdjustMoney(ctx.role, canAccessBranch(ctx, branchId), ctx.branch_ids) });

/** 依訂位的分店檢查角色（只看 session）。write = 要動錢（老闆／本分店店長）；否則唯讀（含 finance）。 */
type GuardedReservation = { id: string; payment_intent_id: string | null; deposit_status: string | null; booking_code: string | null;
  branch_id: string | null };
async function guard(request: NextRequest, reservationId: string, write = true):
  Promise<{ denied: NextResponse } | { ctx: Ctx; reservation: GuardedReservation }> {
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
  const allowed = write
    ? canAdjustMoney(ctx.role, canAccessBranch(ctx, branchId), ctx.branch_ids)
    : canReadRefunds(ctx) && canAccessBranch(ctx, branchId);
  if (!allowed) {
    return { denied: NextResponse.json({ error: write ? "退款要請老闆或這間分店的店長操作" : "退款紀錄只有老闆、店長或財務可以看" },
      { status: 403 }) };
  }
  return { ctx, reservation: { ...(reservation as Omit<GuardedReservation, "branch_id">), branch_id: branchId } };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      reservationId?: string; reason?: string; amount?: number; idempotencyKey?: string; method?: string; kind?: string;
      offSystem?: boolean; reference?: string; cashHandedBack?: boolean;
    };
    if (!body.reservationId) return NextResponse.json({ error: "缺少必填欄位（reservationId）" }, { status: 400 });
    if (!body.reason?.trim()) return NextResponse.json({ error: "退款要填原因" }, { status: 400 });
    if (body.amount != null && (!Number.isInteger(body.amount) || body.amount <= 0)) {
      return NextResponse.json({ error: "退款金額不對" }, { status: 400 });
    }
    const checked = await guard(request, body.reservationId);
    if ("denied" in checked) return checked.denied;
    if (body.offSystem === true) return offSystem(body, checked.ctx, checked.reservation);
    const { ctx, reservation } = checked;

    const kind = body.kind ?? "deposit";
    if (!["deposit", "checkout_deposit_excess"].includes(kind)) return NextResponse.json({ error: "退款類型不對" }, { status: 400 });
    // 結帳欠的訂金差額一律人工退（不經 Stripe）
    const viaStripe = kind === "deposit" && Boolean(reservation.payment_intent_id);
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
      p_kind: kind,
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
    let unknown = false;

    if (viaStripe && ledger.status === "requested") {
      const outcome = await drive(ledger, reservation.payment_intent_id as string, reservation.id, reservation.booking_code);
      if ("response" in outcome) return outcome.response;
      ledger = outcome.ledger;
      unknown = outcome.unknown;
    }

    logOps("payment", "payment.refund_recorded", {
      reservation_id: reservation.id, booking_code: reservation.booking_code, refund_id: ledger.id,
      amount: ledger.amount, method, kind, status: ledger.status, actor: ctx.user_id ?? ctx.role,
    });
    return NextResponse.json({ ok: true, refundId: ledger.id, amount: ledger.amount, status: ledger.status,
      ...(unknown ? { needs_manual_reconcile: true } : {}) });
  } catch (err) {
    console.error("[refund] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "退款失敗" }, { status: 500 });
  }
}

/** 系統外退款補登（A6-2）：API 先擋一次格式，SQL 再全部檢查一次並留稽核警示 */
async function offSystem(
  body: { amount?: number; method?: string; reason?: string; reference?: string; cashHandedBack?: boolean; idempotencyKey?: string },
  ctx: Ctx, reservation: GuardedReservation
): Promise<NextResponse> {
  if (!Number.isInteger(body.amount) || (body.amount as number) <= 0) return NextResponse.json({ error: "退款金額不對" }, { status: 400 });
  const method = body.method ?? "";
  if (!(MANUAL_METHODS as readonly string[]).includes(method)) return NextResponse.json({ error: "請選退款方式" }, { status: 400 });
  if (!body.idempotencyKey?.trim()) return NextResponse.json({ error: "退款請求缺少識別碼，請重新整理再試" }, { status: 400 });
  if (method === "cash" ? body.cashHandedBack !== true : !refundReferenceValid(method, body.reference)) {
    const code = method === "cash" ? "cash_handback_required" : body.reference?.trim() ? "invalid_refund_reference" : "refund_evidence_required";
    return NextResponse.json({ error: settlementFailure({ message: code })?.error ?? code }, { status: 400 });
  }
  const result = await supabaseAdmin().rpc("record_offsystem_refund", {
    p_reservation_id: reservation.id,
    p_amount: body.amount,
    p_method: method,
    p_reason: body.reason!.trim(),
    p_evidence_ref: method === "cash" ? null : body.reference!.trim(),
    p_cash_handed_back: method === "cash" && body.cashHandedBack === true,
    p_idempotency_key: body.idempotencyKey.trim(),
    ...moneyActor(ctx),
  });
  if (result.error) {
    const response = failure(result.error);
    if (response) return response;
    throw result.error;
  }
  const ledger = result.data as RefundLedgerResult;
  logOps("payment", "payment.refund_offsystem_recorded", {
    reservation_id: reservation.id, refund_id: ledger.id, amount: ledger.amount, method, actor: ctx.user_id ?? ctx.role,
  });
  return NextResponse.json({ ok: true, refundId: ledger.id, amount: ledger.amount, status: ledger.status });
}

/**
 * 推進／對帳一筆 Stripe 退款。Stripe 沒回應（網路錯誤）或查不到結果時帳本維持處理中：不算已退、也擋著結帳。
 * 查不到又超過重送期限 → 結果不明：不取消、不解鎖，開警示等人工對帳（A6-6）。店長不能把它取消。
 */
async function drive(ledger: RefundLedgerResult, paymentIntentId: string, reservationId: string, bookingCode: string | null):
  Promise<{ ledger: RefundLedgerResult; unknown: boolean } | { response: NextResponse }> {
  try {
    const outcome = await driveStripeRefund(supabaseAdmin(), stripe!.refunds as never,
      { ...ledger, created_at: ledger.created_at ?? new Date().toISOString() }, paymentIntentId, { reservationId, bookingCode });
    const unknown = Boolean(outcome && "unknown" in outcome);
    if (unknown) {
      logOps("payment", "payment.refund_outcome_unknown", { reservation_id: reservationId, refund_id: ledger.id,
        reason: (outcome as { reason: string }).reason });
    }
    const next = outcome && "id" in outcome ? outcome : ledger;
    if (isDepositFullyRefunded(next)) {
      await supabaseAdmin().from("payment_intents").update({ status: "refunded", updated_at: new Date().toISOString() })
        .eq("stripe_pi_id", paymentIntentId);
    }
    return { ledger: next, unknown };
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
    if (!canReadRefunds(ctx)) {
      return NextResponse.json({ error: "退款紀錄只有老闆、店長或財務可以看" }, { status: 403 });
    }
    const db = supabaseAdmin();
    const reservationId = request.nextUrl.searchParams.get("reservationId");
    if (reservationId) {
      const checked = await guard(request, reservationId, false);
      if ("denied" in checked) return checked.denied;
      const [refunds, alerts, obligations, state] = await Promise.all([
        db.from("reservation_refund_current").select("*").eq("reservation_id", reservationId).order("created_at"),
        db.from("reservation_refund_alerts_with_ack").select("*").eq("reservation_id", reservationId).order("created_at"),
        db.from("reservation_refund_obligations").select("*").eq("reservation_id", reservationId),
        db.rpc("reservation_billing_state", { p_reservation_id: reservationId }),
      ]);
      const error = refunds.error ?? alerts.error ?? obligations.error ?? state.error;
      if (error) return failure(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
      const ids = ((refunds.data ?? []) as Array<{ id: string }>).map((row) => row.id);
      const events = ids.length
        ? await db.from("reservation_refund_events").select("*").in("refund_id", ids).order("seq")
        : { data: [], error: null };
      if (events.error) return failure(events.error) ?? NextResponse.json({ error: events.error.message }, { status: 500 });
      const { reservation } = checked;
      return NextResponse.json({
        viewer: viewer(ctx, reservation.branch_id),
        reservation: { id: reservation.id, booking_code: reservation.booking_code, deposit_status: reservation.deposit_status,
          via_stripe: Boolean(reservation.payment_intent_id) },
        billing: state.data, refunds: refunds.data, events: events.data, alerts: alerts.data, obligations: obligations.data,
      });
    }
    const view = request.nextUrl.searchParams.get("view");
    if (view === "open") return openRefunds(ctx);
    if (view === "ledger") {
      let query = db.from("reservation_refund_current").select("*").order("created_at", { ascending: false }).limit(200);
      if (ctx.branch_ids !== null) query = query.in("branch_id", ctx.branch_ids);
      const ledger = await query;
      if (ledger.error) return failure(ledger.error) ?? NextResponse.json({ error: ledger.error.message }, { status: 500 });
      return NextResponse.json({ viewer: viewer(ctx, null), refunds: ledger.data });
    }
    let query = db.from("reservation_refund_alerts_with_ack").select("*").order("created_at", { ascending: false }).limit(100);
    if (request.nextUrl.searchParams.get("open") === "1") query = query.is("acknowledged_at", null);
    if (ctx.branch_ids !== null) query = query.in("branch_id", ctx.branch_ids);
    const alerts = await query;
    if (alerts.error) return failure(alerts.error) ?? NextResponse.json({ error: alerts.error.message }, { status: 500 });
    return NextResponse.json({ viewer: viewer(ctx, null), alerts: alerts.data });
  } catch (err) {
    console.error("[refund] list error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "讀取退款紀錄失敗" }, { status: 500 });
  }
}

/** 還沒結束的退款、欠客人的訂金差額、還沒有人認領的警示（老闆／finance 看全部，店長只看自己分店）＋訂位資訊 */
async function openRefunds(ctx: Ctx) {
  const db = supabaseAdmin();
  let refunds = db.from("reservation_refund_current").select("*").in("status", ["requested", "pending"]).order("created_at").limit(200);
  let obligations = db.from("reservation_refund_obligations").select("*").order("settled_at").limit(200);
  let alerts = db.from("reservation_refund_alerts_with_ack").select("*").is("acknowledged_at", null)
    .order("created_at", { ascending: false }).limit(100);
  if (ctx.branch_ids !== null) {
    refunds = refunds.in("branch_id", ctx.branch_ids);
    obligations = obligations.in("branch_id", ctx.branch_ids);
    alerts = alerts.in("branch_id", ctx.branch_ids);
  }
  const [open, owed, unacked] = await Promise.all([refunds, obligations, alerts]);
  const error = open.error ?? owed.error ?? unacked.error;
  if (error) return failure(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (open.data ?? []) as Array<{ reservation_id: string }>;
  const owedRows = (owed.data ?? []) as Array<{ reservation_id: string }>;
  const ids = [...new Set([...rows, ...owedRows].map((row) => row.reservation_id))];
  const reservations = ids.length
    ? await db.from("reservations").select("id, booking_code, customer_name, start_time, status").in("id", ids)
    : { data: [], error: null };
  if (reservations.error) throw reservations.error;
  const byId = new Map(((reservations.data ?? []) as Array<{ id: string }>).map((row) => [row.id, row]));
  const withReservation = <T extends { reservation_id: string }>(list: T[]) =>
    list.map((row) => ({ ...row, reservation: byId.get(row.reservation_id) ?? null }));
  return NextResponse.json({ viewer: viewer(ctx, null), refunds: withReservation(rows), obligations: withReservation(owedRows),
    alerts: unacked.data });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      refundId?: string; status?: string; note?: string; reference?: string; reconcile?: boolean; cashHandedBack?: boolean;
      alertId?: string; acknowledge?: boolean;
    };
    if (body.alertId && body.acknowledge === true) return acknowledge(request, body.alertId, body.note);
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
    // D7／A6：不能為了解除「處理中」就直接標成功；證據／原因先在這裡擋一次，SQL 會再檢查一次
    if (row.status !== body.status) {
      const problem = manualRefundProblem({ method: row.method as string, from: row.status as string, to: body.status,
        note: body.note, reference: body.reference, cashHandedBack: body.cashHandedBack === true });
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
      p_cash_handed_back: body.cashHandedBack === true,
    });
    if (result.error) {
      const response = failure(result.error);
      if (response) return response;
      throw result.error;
    }
    const ledger = result.data as RefundLedgerResult;
    logOps("payment", "payment.refund_status_recorded", {
      reservation_id: ledger.reservation_id, refund_id: ledger.id, status: ledger.status, actor: ctx.user_id ?? ctx.role,
      has_evidence: Boolean(body.reference?.trim()), cash_handed_back: body.cashHandedBack === true,
    });
    return NextResponse.json({ ok: true, refundId: ledger.id, status: ledger.status });
  } catch (err) {
    console.error("[refund] status error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "更新退款狀態失敗" }, { status: 500 });
  }
}

/** 認領警示（A6-4）：老闆或警示所屬分店的店長；要寫說明。SQL 再檢查一次 */
async function acknowledge(request: NextRequest, alertId: string, note: string | undefined): Promise<NextResponse> {
  const authDenied = await requireAdminApiAuth(request);
  if (authDenied) return authDenied;
  const ctx = await getAdminContext(request);
  if (!["owner", "branch_manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "警示要由老闆或這間分店的店長認領" }, { status: 403 });
  }
  if (!note?.trim()) return NextResponse.json({ error: settlementFailure({ message: "alert_note_required" })!.error }, { status: 400 });
  const result = await supabaseAdmin().rpc("acknowledge_refund_alert", {
    p_alert_id: alertId, p_note: note.trim(), p_actor: ctx.user_id ?? ctx.role, p_actor_role: ctx.role, p_actor_branch_ids: ctx.branch_ids,
  });
  if (result.error) {
    const mapped = failure(result.error);
    if (mapped) return mapped.status === 409 && result.error.message?.trim() === "refund_not_allowed"
      ? NextResponse.json({ error: "警示要由老闆或這間分店的店長認領" }, { status: 403 }) : mapped;
    throw result.error;
  }
  logOps("payment", "payment.refund_alert_acknowledged", { alert_id: alertId, actor: ctx.user_id ?? ctx.role });
  return NextResponse.json({ ok: true, alertId, acknowledgedBy: (result.data as { acknowledged_by?: string })?.acknowledged_by });
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
    status: outcome.ledger.status, actor: "reconcile", unknown: outcome.unknown });
  if (outcome.unknown) {
    return NextResponse.json({ ok: false, refundId: row.id, status: outcome.ledger.status, needs_manual_reconcile: true,
      error: "Stripe 查不到這筆退款的結果：維持處理中、這組先不能結帳，已開警示，請到 Stripe 後台人工對帳" }, { status: 202 });
  }
  return NextResponse.json({ ok: true, refundId: outcome.ledger.id, status: outcome.ledger.status });
}
