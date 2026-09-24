import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { getReservationForPreorder, getReservationPreorder, validateAndSnapshotItems, canonicalDraftItems, type DraftItemInput } from "@/lib/reservation-preorder";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Params = { params: Promise<{ id: string }> };
type Action = "check_in" | "save_preorder" | "add_items" | "replace_item" | "update_quantity" | "remove_item" | "serve_item" | "settle";

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
  const [preorder, orderResult] = await Promise.all([
    getReservationPreorder(id),
    db.from("orders").select("*, order_items(*)").eq("reservation_id", id).maybeSingle(),
  ]);
  if (orderResult.error) throw orderResult.error;
  return { preorder, order: orderResult.data };
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
      item_id?: string; notes?: string | null; quantity?: number;
    };
    const db = supabaseAdmin();
    const { order } = await load(id);
    if (body.action === "check_in") {
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
