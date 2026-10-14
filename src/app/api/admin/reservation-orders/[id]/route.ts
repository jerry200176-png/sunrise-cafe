import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { getReservationForPreorder, getReservationPreorder, validateAndSnapshotItems, canonicalDraftItems, type DraftItemInput } from "@/lib/reservation-preorder";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { computeCheckoutBill, newEndProblem, nextBlockingStart } from "@/lib/room-checkout";
import { isPostgresExclusionViolation } from "@/lib/slot-conflict";
import { transitionHttp, transitionReservation } from "@/lib/reservation-lifecycle";
import { logOps } from "@/lib/ops-log";

type Params = { params: Promise<{ id: string }> };
type Action = "check_in" | "save_preorder" | "add_items" | "replace_item" | "update_quantity" | "remove_item" | "serve_item" | "settle"
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
  }) : null;
  return { preorder, order: orderResult.data, billing: { ...billing.reservation, next_start: billing.nextStart, bill } };
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
  return {
    reservation: { id: data.id as string, room_id: data.room_id as string, start_time: data.start_time as string,
      end_time: data.end_time as string, status: data.status as string,
      total_price: data.total_price == null ? null : Number(data.total_price),
      // 退過款的訂金（Stripe 退款只改 deposit_status，is_deposit_paid 仍為 true）不能再扣
      is_deposit_paid: Boolean(data.is_deposit_paid) && data.deposit_status !== "refunded" },
    room: (room ?? null) as { price_weekday: number; price_weekend: number } | null,
    nextStart: nextBlockingStart(data, sameRoom ?? []),
  };
}

async function updateStatus(orderId: string) {
  const db = supabaseAdmin();
  const { data: order, error } = await db.from("orders").select("paid_at,order_items(served_at)").eq("id", orderId).single();
  if (error) throw error;
  const rows = order.order_items ?? [];
  const allServed = rows.length > 0 && rows.every((row) => row.served_at);
  const status = allServed ? (order.paid_at ? "completed" : "ready")
    : rows.some((row) => row.served_at) ? "preparing" : order.paid_at && rows.length === 0 ? "completed" : "pending";
  const result = await db.from("orders").update({ status }).eq("id", orderId);
  if (result.error) throw result.error;
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
    };
    const db = supabaseAdmin();
    const { order, billing: current } = await load(id);
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
    if (body.action === "extend") {
      // 只給已報到、尚未結帳的組調整結束時間（店員現場延時／提早離開）；不改 total_price，不推 LINE。
      if (auth.reservation!.status !== "checked_in") return NextResponse.json({ error: "客人到了以後才能改時間" }, { status: 409 });
      const endTime = typeof body.end_time === "string" ? new Date(body.end_time) : null;
      if (!endTime || Number.isNaN(endTime.getTime())) return NextResponse.json({ error: "時間沒填好，請重新選一次" }, { status: 400 });
      const { reservation, nextStart } = await loadBilling(id);
      const problem = newEndProblem(reservation.start_time, endTime.toISOString(), nextStart);
      if (problem) return NextResponse.json({ error: problem }, { status: 409 });
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
          await undoPaid();
          throw error;
        }
        if (!transition.ok) {
          await undoPaid();
          const { status, body: failure } = transitionHttp(transition);
          return NextResponse.json(failure, { status });
        }
      }
      await updateStatus(order.id);
      logOps("admin", "admin.room_checked_out", { reservation_id: id, due, actor: ctx.user_id ?? ctx.role });
      return NextResponse.json({ ok: true, ...(await load(id)) });
    }
    const EDIT_ACTIONS = ["add_items", "replace_item", "update_quantity", "remove_item"];
    if (EDIT_ACTIONS.includes(body.action ?? "") && auth.reservation!.status !== "checked_in") {
      // 結帳完（或取消）的組只能補記餐費、標記出餐，不能再加點或改單
      return NextResponse.json({ error: "這組已經結帳離開，不能再加點或改餐點" }, { status: 409 });
    }
    if (body.action === "settle") {
      if (!order.paid_at) {
        const result = await db.from("orders").update({ paid_at: new Date().toISOString() }).eq("id", order.id).is("paid_at", null);
        if (result.error) throw result.error;
      }
    } else if (body.action === "add_items" || body.action === "replace_item") {
      if (order.paid_at) return NextResponse.json({ error: "已結帳，不能修改餐點" }, { status: 409 });
      const input = body.action === "add_items" ? body.items : body.item ? [body.item] : null;
      if (!input?.length) return NextResponse.json({ error: "缺少餐點" }, { status: 400 });
      const snapshots = await validateAndSnapshotItems(auth.reservation!, input, false);
      const changes = snapshots.map((snapshot) => ({ menu_item_id: snapshot.source_menu_item_id, item_name: snapshot.item_name_snapshot,
        quantity: snapshot.quantity, unit_price: snapshot.unit_price_snapshot,
        selected_options: snapshot.selected_options_snapshot, special_notes: snapshot.special_notes }));
      if (body.action === "add_items") {
        const result = await db.from("order_items").insert(changes.map((item) => ({ order_id: order.id, ...item })));
        if (result.error) throw result.error;
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
    await updateStatus(order.id);
    return NextResponse.json({ ok: true, ...(await load(id)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失敗";
    return NextResponse.json({ error: message }, { status: /cannot|requires|無法|已|找不到/.test(message) ? 409 : 500 });
  }
}
