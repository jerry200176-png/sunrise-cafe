import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { getReservationForPreorder, getReservationPreorder, validateAndSnapshotItems, canonicalDraftItems, type DraftItemInput } from "@/lib/reservation-preorder";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { computeCheckoutBill, newEndProblem, nextBlockingStart } from "@/lib/room-checkout";
import { isPostgresExclusionViolation } from "@/lib/slot-conflict";
import { afterSettledComplete, transitionHttp, transitionReservation } from "@/lib/reservation-lifecycle";
import { canAdjustMoney, isPaymentMethod, isSettlementSchemaMissing, settlementFailure } from "@/lib/room-settlement";
import { canAccessBranch, type AdminContext } from "@/lib/rbac";
import { logOps } from "@/lib/ops-log";

type Params = { params: Promise<{ id: string }> };
type Action = "check_in" | "save_preorder" | "add_items" | "add_status" | "cancel_add" | "replace_item" | "update_quantity" | "remove_item" | "serve_item" | "settle"
  | "extend" | "checkout";

async function authorized(request: NextRequest, id: string, write: boolean) {
  const denied = await requirePermission(request, write ? "orders:write" : "orders:read");
  if (denied) return { denied };
  const reservation = await getReservationForPreorder(id);
  const room = Array.isArray(reservation?.room) ? reservation.room[0] : reservation?.room;
  if (!reservation || !room?.branch_id) return { denied: NextResponse.json({ error: "找不到訂位" }, { status: 404 }) };
  const scoped = await requirePermission(request, write ? "orders:write" : "orders:read", room.branch_id);
  if (scoped) return { denied: scoped };
  return { reservation, branchId: room.branch_id };
}

async function load(id: string) {
  const db = supabaseAdmin();
  const [preorder, orderResult, billing] = await Promise.all([
    getReservationPreorder(id),
    db.from("orders").select("*, order_items(*)").eq("reservation_id", id).maybeSingle(),
    loadBilling(id),
  ]);
  if (orderResult.error) throw orderResult.error;
  const bill = billing.room ? computeCheckoutBill({
    room: billing.room, startTime: billing.reservation.start_time, endTime: billing.reservation.end_time,
    bookedTotal: billing.reservation.total_price, isDepositPaid: Boolean(billing.reservation.is_deposit_paid),
    foodTotal: Number(orderResult.data?.total_amount) || 0,
    foodSettled: Boolean(orderResult.data?.paid_at) && billing.reservation.status !== "completed",
    extensions: billing.extensions,
  }) : null;
  return { preorder, order: orderResult.data, settlementsReady: billing.extensions !== null,
    billing: { ...billing.reservation, next_start: billing.nextStart, bill } };
}

/** 現場結帳需要的包廂費率、訂位金額與同包廂下一組開始時間（延時上限）。 */
async function loadBilling(id: string) {
  const db = supabaseAdmin();
  const { data, error } = await db.from("reservations")
    .select("id,room_id,start_time,end_time,status,total_price,is_deposit_paid,deposit_status,room:rooms(price_weekday,price_weekend)")
    .eq("id", id).single();
  if (error) throw error;
  const room = Array.isArray(data.room) ? data.room[0] : data.room;
  const { data: sameRoom, error: sameRoomError } = await db.from("reservations")
    .select("id,room_id,start_time,status").eq("room_id", data.room_id)
    .gte("start_time", data.start_time).neq("status", "cancelled").neq("id", id).order("start_time").limit(5);
  if (sameRoomError) throw sameRoomError;
  // 延長紀錄（#444）。表還不存在 = migration 尚未套用：extensions 為 null，全部走舊流程
  const ext = await db.from("reservation_extensions").select("minutes,fee").eq("reservation_id", id);
  if (ext.error && !isSettlementSchemaMissing(ext.error)) throw ext.error;
  const extensions = ext.error ? null : (ext.data ?? []).reduce((sum, row) =>
    ({ minutes: sum.minutes + Number(row.minutes), fee: sum.fee + Number(row.fee) }), { minutes: 0, fee: 0 });
  return {
    reservation: { id: data.id as string, room_id: data.room_id as string, start_time: data.start_time as string,
      end_time: data.end_time as string, status: data.status as string,
      total_price: data.total_price == null ? null : Number(data.total_price),
      // 退過款的訂金（Stripe 退款只改 deposit_status，is_deposit_paid 仍為 true）不能再扣
      is_deposit_paid: Boolean(data.is_deposit_paid) && data.deposit_status !== "refunded" },
    room: (room ?? null) as { price_weekday: number; price_weekend: number } | null,
    // 套用 migration 後「沒來」不再佔時段，延長上限也跟著放寬
    nextStart: nextBlockingStart(data, sameRoom ?? [], extensions ? ["cancelled", "no_show"] : ["cancelled"]),
    extensions,
  };
}

/** 呼叫 settle_reservation_checkout：expected 是店員畫面上（打折前）的應收與應退，伺服器會重算核對。 */
async function settle(
  id: string,
  branchId: string,
  body: { payment_method?: string; discount_amount?: number; discount_reason?: string | null },
  expectedBeforeDiscount: number,
  expectedRefund: number,
  ctx: AdminContext
): Promise<{ id: string } | { response: NextResponse }> {
  const discount = body.discount_amount ?? 0;
  if (!Number.isInteger(discount) || discount < 0) return { response: NextResponse.json({ error: "折扣金額不對" }, { status: 400 }) };
  // 角色只看登入 session（ctx），前端送什麼都不採信；資料庫函式會再檢查一次
  if ((discount > 0 || expectedRefund > 0) && !canAdjustMoney(ctx.role, canAccessBranch(ctx, branchId))) {
    return { response: NextResponse.json({ error: discount > 0 ? "只有老闆或店長可以打折" : "退錢要請老闆或店長操作" }, { status: 403 }) };
  }
  const collected = Math.max(0, expectedBeforeDiscount - discount);
  const method = body.payment_method ?? null;
  if ((collected > 0 || expectedRefund > 0) && !isPaymentMethod(method)) {
    return { response: NextResponse.json({ error: "請選付款方式" }, { status: 400 }) };
  }
  const result = await supabaseAdmin().rpc("settle_reservation_checkout", {
    p_reservation_id: id,
    p_expected_before_discount: expectedBeforeDiscount,
    p_expected_refund: expectedRefund,
    p_payment_method: method ?? "none",
    p_amount_collected: collected,
    p_discount_amount: discount,
    p_discount_reason: body.discount_reason ?? null,
    p_actor: ctx.user_id ?? ctx.role ?? null,
    p_actor_role: ctx.role ?? null,
  });
  if (result.error) {
    const failure = settlementFailure(result.error);
    if (failure) return { response: NextResponse.json({ error: failure.error }, { status: failure.status }) };
    throw result.error;
  }
  return { id: (result.data as { id: string }).id };
}

export async function GET(request: NextRequest, { params }: Params) {
  const id = (await params).id;
  try {
    const auth = await authorized(request, id, false);
    if (auth.denied) return auth.denied;
    return NextResponse.json({ reservation: auth.reservation, ...(await load(id)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "載入失敗" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const id = (await params).id;
  try {
    const auth = await authorized(request, id, true);
    if (auth.denied) return auth.denied;
    const body = await request.json() as {
      action: Action; item?: DraftItemInput; items?: DraftItemInput[];
      item_id?: string; notes?: string | null; quantity?: number; end_time?: string; expected_due?: number; expected_refund?: number;
      payment_method?: string; discount_amount?: number; discount_reason?: string | null;
      idempotency_key?: string;
    };
    const db = supabaseAdmin();
    const { order, billing: current, settlementsReady } = await load(id);
    if (body.action === "check_in") {
      if (order && ["pending", "confirmed"].includes(auth.reservation!.status)) {
        // 取消後又恢復的訂位：現場訂單還在，activate RPC 看到訂單就直接返回，不會改狀態，所以走狀態轉換保留原訂單
        const ctx = await getAdminContext(request);
        const transition = await transitionReservation(id, { type: "check_in" }, { kind: "admin", userId: ctx.user_id, label: ctx.role });
        if (!transition.ok) {
          const { status, body: failure } = transitionHttp(transition);
          return NextResponse.json(failure, { status });
        }
        return NextResponse.json({ ok: true, ...(await load(id)) });
      }
      const result = await db.rpc("activate_reservation_order", { p_reservation_id: id });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, ...(await load(id)) });
    }
    if (body.action === "save_preorder") {
      if (order) return NextResponse.json({ error: "已到店，請修改現場訂單" }, { status: 409 });
      const items = canonicalDraftItems(body.items ?? []);
      await validateAndSnapshotItems(auth.reservation!, items);
      const result = await db.rpc("staff_replace_preorder", { p_reservation_id: id, p_items: items, p_guest_notes: body.notes ?? null });
      if (result.error) throw result.error;
      return NextResponse.json({ ok: true, ...(await load(id)) });
    }
    if (!order) return NextResponse.json({ error: "請先確認客人到店" }, { status: 409 });
    if (body.action === "add_status" || body.action === "cancel_add") {
      const key = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
      if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) return NextResponse.json({ error: "加點識別碼不正確" }, { status: 400 });
      if (body.action === "add_status") {
        const result = await db.from("reservation_order_add_requests").select("state")
          .eq("reservation_id", id).eq("request_key", key).maybeSingle();
        if (result.error) return NextResponse.json({ error: "無法確認加點狀態" }, { status: 503 });
        const state = result.data?.state ?? "unknown";
        if (!["unknown", "committed", "canceled"].includes(state)) return NextResponse.json({ error: "無法確認加點狀態" }, { status: 503 });
        return NextResponse.json({ ok: true, state });
      }
      const result = await db.rpc("cancel_reservation_order_add", { p_reservation_id: id, p_order_id: order.id, p_request_key: key });
      if (result.error || !["committed", "canceled"].includes(result.data?.state)) return NextResponse.json({ error: "無法確認加點狀態" }, { status: 503 });
      return NextResponse.json({ ok: true, state: result.data.state });
    }
    // A replay must be recognized before checking the reservation's current
    // state or today's menu: the first request may have committed before the
    // connection failed, even if the stay has since ended or items sold out.
    let addRequest: { key: string; hash: string; items: DraftItemInput[] } | null = null;
    if (body.action === "add_items") {
      const key = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
      if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
        return NextResponse.json({ error: "加點頁面需要更新，請重新整理後再試" }, { status: 400 });
      }
      let items: DraftItemInput[];
      try { items = canonicalDraftItems(body.items ?? []); }
      catch { return NextResponse.json({ error: "餐點資料不正確，請確認後再試" }, { status: 400 }); }
      if (!items.length) return NextResponse.json({ error: "缺少餐點" }, { status: 400 });
      const hash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
      const previous = await db.from("reservation_order_add_requests").select("payload_hash,state")
        .eq("reservation_id", id).eq("request_key", key).maybeSingle();
      if (previous.error) return NextResponse.json({ error: "無法確認加點狀態，請勿重複加點；請稍後以原請求重試" }, { status: 503 });
      if (previous.data) {
        if (previous.data.state === "canceled") return NextResponse.json({ error: "此筆加點已取消，請重新選擇餐點" }, { status: 409 });
        if (previous.data.payload_hash !== hash) return NextResponse.json({ error: "加點識別碼與餐點內容不一致，請先確認訂單" }, { status: 409 });
        try { return NextResponse.json({ ok: true, committed: true, already_processed: true, ...(await load(id)) }); }
        catch { return NextResponse.json({ ok: true, committed: true, already_processed: true, refresh_failed: true }); }
      }
      addRequest = { key, hash, items };
    }
    if (body.action === "extend") {
      // 只給已報到、尚未結帳的組調整結束時間（店員現場延時／提早離開）；不改 total_price，不推 LINE。
      if (auth.reservation!.status !== "checked_in") return NextResponse.json({ error: "客人到了以後才能改時間" }, { status: 409 });
      const endTime = typeof body.end_time === "string" ? new Date(body.end_time) : null;
      if (!endTime || Number.isNaN(endTime.getTime())) return NextResponse.json({ error: "時間沒填好，請重新選一次" }, { status: 400 });
      const { reservation, nextStart } = await loadBilling(id);
      const problem = newEndProblem(reservation.start_time, endTime.toISOString(), nextStart);
      if (problem) return NextResponse.json({ error: problem }, { status: 409 });
      if (settlementsReady) {
        // 改時間＋記延長紀錄在同一個 transaction；帶上剛讀到的結束時間，兩台同時延長時後到的會失敗
        const ctx = await getAdminContext(request);
        const result = await db.rpc("extend_reservation_stay", { p_reservation_id: id, p_expected_end: reservation.end_time,
          p_new_end: endTime.toISOString(), p_actor: ctx.user_id ?? ctx.role });
        if (result.error) {
          const failure = settlementFailure(result.error);
          if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
          throw result.error;
        }
        logOps("admin", "admin.reservation_extended", { reservation_id: id, from: reservation.end_time, to: endTime.toISOString(), actor: ctx.user_id ?? ctx.role });
        return NextResponse.json({ ok: true, ...(await load(id)) });
      }
      // 帶上剛讀到的結束時間：兩台同時延長時，後到的那台會 409，不會蓋掉前一台
      const result = await db.from("reservations").update({ end_time: endTime.toISOString() })
        .eq("id", id).eq("status", "checked_in").eq("end_time", reservation.end_time).select("id");
      if (result.error) {
        if (isPostgresExclusionViolation(result.error)) return NextResponse.json({ error: "會跟這間的其他客人時間重疊，請換包廂或先問問對方" }, { status: 409 });
        throw result.error;
      }
      if (!result.data.length) return NextResponse.json({ error: "這組剛剛被別人改過，請重新整理再試一次" }, { status: 409 });
      const ctx = await getAdminContext(request);
      logOps("admin", "admin.reservation_extended", { reservation_id: id, from: reservation.end_time, to: endTime.toISOString(), actor: ctx.user_id ?? ctx.role });
      return NextResponse.json({ ok: true, ...(await load(id)) });
    }
    if (body.action === "checkout") {
      // 結帳並完成。店員確認的金額必須等於伺服器現在算出的金額（別台剛加餐或延長就擋下）。
      const due = current.bill?.due ?? null;
      // 只有在包廂裡的客人能結帳；已完成的組只走補記餐費（還沒到的組不能先被標成已完成）
      if (!["checked_in", "completed"].includes(auth.reservation!.status)) {
        return NextResponse.json({ error: "客人到了以後才能結帳" }, { status: 409 });
      }
      const refund = current.bill?.refund ?? 0;
      // 要收和要退都要對得上：退款時 due 都是 0，只比 due 會放過過期的退款金額
      if (auth.reservation!.status !== "completed" && (typeof body.expected_due !== "number" || body.expected_due !== due
        || (body.expected_refund ?? 0) !== refund)) {
        return NextResponse.json({ error: `金額剛剛有變動（現在要收 NT$ ${(due ?? 0).toLocaleString()}），請再確認一次`, billing: current }, { status: 409 });
      }
      const ctx = await getAdminContext(request);
      if (settlementsReady) {
        if (auth.reservation!.status !== "checked_in") return NextResponse.json({ error: "這組已經結過帳了，請重新整理看結果" }, { status: 409 });
        const settled = await settle(id, auth.branchId!, body, due ?? 0, refund, ctx);
        if ("response" in settled) return settled.response;
        // 訂位已在 RPC 裡轉成 completed；附帶動作失敗不影響已結帳
        try {
          await afterSettledComplete(id, { kind: "admin", userId: ctx.user_id, label: ctx.role }, "checked_in");
        } catch (error) {
          logOps("admin", "admin.room_checkout_side_effect_failed", { reservation_id: id, error: error instanceof Error ? error.message : String(error) });
        }
        logOps("admin", "admin.room_checked_out", { reservation_id: id, due, actor: ctx.user_id ?? ctx.role, settlement_id: settled.id });
        return NextResponse.json({ ok: true, ...(await load(id)) });
      }
      // 沒有資料庫交易可用：先記已收，再轉「已完成」；轉換被拒絕或出錯就把剛記的已收撤回
      // （只撤回自己寫的那一筆）。萬一撤回也失敗，留下的是「已收但仍在包廂內」，
      // 場控圖上看得到、重按結帳會略過記帳只補轉換，不會卡住。
      const paidAt = new Date().toISOString();
      let wrotePaid = false;
      if (!order.paid_at) {
        const result = await db.from("orders").update({ paid_at: paidAt }).eq("id", order.id).is("paid_at", null).select("id");
        if (result.error) throw result.error;
        wrotePaid = result.data.length > 0;
        // 沒寫成功 = 另一台剛好同時在結帳：交給那一台，這台不要繼續轉成已完成
        if (!wrotePaid) return NextResponse.json({ error: "另一台裝置正在幫這組結帳，請重新整理看結果" }, { status: 409 });
      }
      const undoPaid = async () => {
        if (!wrotePaid) return;
        const undo = await db.from("orders").update({ paid_at: null }).eq("id", order.id).eq("paid_at", paidAt);
        if (undo.error) console.error("[checkout] 撤回已收失敗", order.id, undo.error.message);
      };
      if (wrotePaid) {
        // 記已收之後資料庫就不准再改餐點（guard trigger 會鎖單並擋下），此時的總額就是最終總額。
        // 若在「核對金額」到「記已收」之間別台剛好加了餐，總額會不同：撤回並請店員重新確認。
        const after = await db.from("orders").select("total_amount").eq("id", order.id).single();
        if (after.error) { await undoPaid(); throw after.error; }
        if (Number(after.data.total_amount) !== Number(order.total_amount)) {
          await undoPaid();
          return NextResponse.json({ error: "剛剛有人加點或改了餐點，金額變了，請再確認一次" }, { status: 409 });
        }
      }
      if (auth.reservation!.status !== "completed") {
        let transition: Awaited<ReturnType<typeof transitionReservation>>;
        try {
          transition = await transitionReservation(id, { type: "complete" }, { kind: "admin", userId: ctx.user_id, label: ctx.role });
        } catch (error) {
          // 狀態可能已寫成 completed、只是後續附帶動作失敗：那就已經結帳了，不能把收款撤掉
          const now = await db.from("reservations").select("status").eq("id", id).maybeSingle();
          if (now.data?.status !== "completed") {
            await undoPaid();
            throw error;
          }
          logOps("admin", "admin.room_checkout_side_effect_failed", { reservation_id: id, error: error instanceof Error ? error.message : String(error) });
          transition = { ok: true } as Awaited<ReturnType<typeof transitionReservation>>;
        }
        if (!transition.ok) {
          await undoPaid();
          const { status, body: failure } = transitionHttp(transition);
          return NextResponse.json(failure, { status });
        }
      }
      logOps("admin", "admin.room_checked_out", { reservation_id: id, due, actor: ctx.user_id ?? ctx.role });
      return NextResponse.json({ ok: true, ...(await load(id)) });
    }
    const EDIT_ACTIONS = ["add_items", "replace_item", "update_quantity", "remove_item"];
    if (EDIT_ACTIONS.includes(body.action ?? "") && auth.reservation!.status !== "checked_in") {
      // 結帳完（或取消）的組只能補記餐費、標記出餐，不能再加點或改單
      return NextResponse.json({ error: "這組已經結帳離開，不能再加點或改餐點" }, { status: 409 });
    }
    // 餐費 0 元沒有東西可收：RPC 會回 nothing_to_settle，所以不走 food_only 結帳紀錄，
    // 改走下面的舊流程只標記 paid_at（不動 SQL；#447 P2-2）
    const leftoverFood = Math.round(Number(order.total_amount) || 0);
    if (body.action === "settle" && settlementsReady && leftoverFood > 0
      && ["completed", "cancelled", "no_show"].includes(auth.reservation!.status)) {
      // 已結束／取消／沒來的組補收餐費：寫一筆只有餐費的結帳紀錄。這些組不能再改餐點，所以金額就是目前的餐費
      if (order.paid_at) return NextResponse.json({ error: "這組的餐費已經收過了" }, { status: 409 });
      const food = leftoverFood;
      const ctx = await getAdminContext(request);
      // 舊點餐頁的「補記」按鈕沒有付款方式可選：記成「其他」
      const settled = await settle(id, auth.branchId!, { ...body, payment_method: body.payment_method ?? "other" }, food, 0, ctx);
      if ("response" in settled) return settled.response;
    } else if (body.action === "settle") {
      if (!order.paid_at) {
        const result = await db.from("orders").update({ paid_at: new Date().toISOString() }).eq("id", order.id).is("paid_at", null);
        if (result.error) throw result.error;
      }
    } else if (body.action === "add_items" || body.action === "replace_item") {
      if (order.paid_at) return NextResponse.json({ error: "已結帳，不能修改餐點" }, { status: 409 });
      const input = body.action === "add_items" ? addRequest?.items : body.item ? [body.item] : null;
      if (!input?.length) return NextResponse.json({ error: "缺少餐點" }, { status: 400 });
      const snapshots = await validateAndSnapshotItems(auth.reservation!, input, false);
      const changes = snapshots.map((snapshot) => ({ menu_item_id: snapshot.source_menu_item_id, item_name: snapshot.item_name_snapshot,
        quantity: snapshot.quantity, unit_price: snapshot.unit_price_snapshot,
        selected_options: snapshot.selected_options_snapshot, special_notes: snapshot.special_notes }));
      if (body.action === "add_items") {
        const result = await db.rpc("add_reservation_order_items_once", {
          p_reservation_id: id, p_order_id: order.id, p_request_key: addRequest!.key,
          p_payload_hash: addRequest!.hash, p_items: changes,
        });
        if (result.error) {
          const message = String(result.error.message ?? "");
          if (message.includes("add_request_canceled")) return NextResponse.json({ error: "此筆加點已取消，請重新選擇餐點" }, { status: 409 });
          if (message.includes("add_request_key_mismatch")) return NextResponse.json({ error: "加點識別碼與餐點內容不一致，請先確認訂單" }, { status: 409 });
          if (message.includes("order_cannot_add")) return NextResponse.json({ error: "訂單狀態已變更，請先確認是否已結帳" }, { status: 409 });
          return NextResponse.json({ error: "無法確認加點狀態，請勿重複加點；請稍後以原請求重試" }, { status: 503 });
        }
        if (!result.data || result.data.committed !== true) {
          return NextResponse.json({ error: "無法確認加點狀態，請勿重複加點；請稍後以原請求重試" }, { status: 503 });
        }
        // The RPC commits all items, the ledger and status atomically.
        try {
          return NextResponse.json({ ok: true, ...(await load(id)) });
        } catch {
          return NextResponse.json({ ok: true, committed: true, refresh_failed: true });
        }
      } else {
        if (!body.item_id) return NextResponse.json({ error: "缺少明細 ID" }, { status: 400 });
        const result = await db.from("order_items").update(changes[0]).eq("id", body.item_id).eq("order_id", order.id).is("served_at", null).select("id");
        if (result.error) throw result.error;
        if (!result.data.length) return NextResponse.json({ error: "已出餐或找不到此餐點" }, { status: 409 });
      }
    } else if (body.action === "update_quantity") {
      if (!body.item_id || !Number.isInteger(body.quantity) || body.quantity! < 1 || body.quantity! > 99) {
        return NextResponse.json({ error: "數量需為 1 到 99" }, { status: 400 });
      }
      if (order.paid_at) return NextResponse.json({ error: "已結帳，不能修改餐點" }, { status: 409 });
      const result = await db.from("order_items").update({ quantity: body.quantity }).eq("id", body.item_id)
        .eq("order_id", order.id).is("served_at", null).select("id");
      if (result.error) throw result.error;
      if (!result.data.length) return NextResponse.json({ error: "已出餐或找不到此餐點" }, { status: 409 });
    } else if (body.action === "serve_item" && ["pending", "confirmed"].includes(auth.reservation!.status)) {
      // 還沒報到（例如取消後又恢復）的組不能先標記出餐
      return NextResponse.json({ error: "客人到了以後才能標記送餐" }, { status: 409 });
    } else if (body.action === "remove_item" || body.action === "serve_item") {
      if (!body.item_id) return NextResponse.json({ error: "缺少明細 ID" }, { status: 400 });
      if (body.action === "remove_item" && order.paid_at) return NextResponse.json({ error: "已結帳，不能刪除餐點" }, { status: 409 });
      const query = body.action === "remove_item"
        ? db.from("order_items").delete().eq("id", body.item_id).eq("order_id", order.id).is("served_at", null).select("id")
        : db.from("order_items").update({ served_at: new Date().toISOString() }).eq("id", body.item_id).eq("order_id", order.id).is("served_at", null).select("id");
      const result = await query;
      if (result.error) throw result.error;
      if (!result.data.length) return NextResponse.json({ error: "已處理或找不到此餐點" }, { status: 409 });
    } else {
      return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await load(id)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失敗";
    return NextResponse.json({ error: message }, { status: /cannot|requires|無法|已|找不到/.test(message) ? 409 : 500 });
  }
}
