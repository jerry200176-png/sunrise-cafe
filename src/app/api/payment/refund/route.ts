import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeEnabled } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAdminContext, requireAdminApiAuth } from "@/lib/admin-api-auth";
import { canAccessBranch } from "@/lib/rbac";
import { logOps } from "@/lib/ops-log";
import { canAdjustMoney, isSettlementSchemaMissing, moneyActor, settlementFailure } from "@/lib/room-settlement";
import { isDepositFullyRefunded, syncStripeRefund, type RefundLedgerResult } from "@/lib/refund-ledger";

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
 * PATCH { refundId, status: "pending" | "succeeded" | "failed" | "canceled", note? }
 *   確認人工退款的結果；Stripe 退款的結果只能由 Stripe 回報（只能取消卡在 requested 的請求）
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
async function guard(request: NextRequest, reservationId: string) {
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
  return { ctx, reservation };
}

export async function POST(request: NextRequest) {
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

    // 1) 先記帳本（requested）：鎖訂位、檢查可退上限與角色。同一個冪等鍵重送會拿回同一筆
    const requested = await supabaseAdmin().rpc("request_reservation_refund", {
      p_reservation_id: reservation.id,
      p_kind: "deposit",
      p_amount: body.amount ?? null,
      p_method: method,
      p_reason: body.reason.trim(),
      p_idempotency_key: body.idempotencyKey?.trim() || `refund:${randomUUID()}`,
      ...moneyActor(ctx),
    });
    if (requested.error) {
      const response = failure(requested.error);
      if (response) return response;
      throw requested.error;
    }
    let ledger = requested.data as RefundLedgerResult;

    if (viaStripe && ledger.status === "requested") {
      // 2) 呼叫 Stripe。冪等鍵綁帳本編號：重送（或上次在這裡中斷）也不會退兩次
      let refund;
      try {
        refund = await stripe!.refunds.create(
          {
            payment_intent: reservation.payment_intent_id as string,
            amount: ledger.amount,
            reason: "requested_by_customer",
            metadata: { refund_ledger_id: ledger.id, reservationId: reservation.id, bookingCode: reservation.booking_code ?? "" },
          },
          { idempotencyKey: `ledger_refund_${ledger.id}` }
        );
      } catch (err) {
        // 結果不明（網路／Stripe 錯誤）：帳本留在 requested（不算已退，也會擋結帳），之後重送同一冪等鍵或等 webhook
        logOps("payment", "payment.refund_provider_error", {
          reservation_id: reservation.id, refund_id: ledger.id, error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: "Stripe 還沒回覆退款結果，請稍後重新整理或再按一次（不會重複退）", refundId: ledger.id,
          status: ledger.status }, { status: 502 });
      }
      // 3) 照 Stripe 回的狀態記（pending 就是 pending，不當成已退）
      const synced = await syncStripeRefund(supabaseAdmin(), refund);
      if (synced && !("schemaMissing" in synced)) ledger = synced;
      if (isDepositFullyRefunded(ledger)) {
        await supabaseAdmin().from("payment_intents").update({ status: "refunded", updated_at: new Date().toISOString() })
          .eq("stripe_pi_id", reservation.payment_intent_id);
      }
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

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { refundId?: string; status?: string; note?: string };
    if (!body.refundId || !body.status) return NextResponse.json({ error: "缺少必填欄位（refundId, status）" }, { status: 400 });
    if (!["pending", "succeeded", "failed", "canceled"].includes(body.status)) {
      return NextResponse.json({ error: "退款狀態不對" }, { status: 400 });
    }
    const { data: row, error } = await supabaseAdmin().from("reservation_refunds").select("id, reservation_id")
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
    const result = await supabaseAdmin().rpc("record_reservation_refund_status", {
      p_refund_id: row.id,
      p_status: body.status,
      p_provider_ref: null,
      p_note: body.note ?? null,
      ...moneyActor(ctx),
    });
    if (result.error) {
      const response = failure(result.error);
      if (response) return response;
      throw result.error;
    }
    const ledger = result.data as RefundLedgerResult;
    logOps("payment", "payment.refund_status_recorded", {
      reservation_id: ledger.reservation_id, refund_id: ledger.id, status: ledger.status, actor: ctx.user_id ?? ctx.role,
    });
    return NextResponse.json({ ok: true, refundId: ledger.id, status: ledger.status });
  } catch (err) {
    console.error("[refund] status error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "更新退款狀態失敗" }, { status: 500 });
  }
}
