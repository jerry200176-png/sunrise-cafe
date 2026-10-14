import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { isAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { taipeiDateKey, taipeiDayWindow } from "@/lib/admin-today";
import type { FloorReservation } from "@/lib/room-checkout";

export type FloorRoom = {
  id: string;
  name: string;
  type: string | null;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
};

export type FloorOrderSummary = {
  reservation_id: string;
  total_amount: number;
  paid_at: string | null;
  item_count: number;
  unserved_count: number;
};

export type FloorBundle = {
  date: string;
  generated_at: string;
  rooms: FloorRoom[];
  reservations: FloorReservation[];
  orders: FloorOrderSummary[];
};

/** 包廂場控：分店今日所有包廂、訂位與現場訂單摘要（orders:read + 分店範圍）。 */
export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  const denied = await requirePermission(request, "orders:read", branchId);
  if (denied) return denied;
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
    const date = request.nextUrl.searchParams.get("date") ?? taipeiDateKey();
    const window = taipeiDayWindow(date);
    const db = supabaseAdmin();
    const roomsResult = await db.from("rooms")
      .select("id,name,type,capacity,price_weekday,price_weekend")
      .eq("branch_id", branchId).order("name");
    if (roomsResult.error) throw roomsResult.error;
    const rooms = (roomsResult.data ?? []) as FloorRoom[];
    if (rooms.length === 0) {
      return NextResponse.json({ date, generated_at: new Date().toISOString(), rooms, reservations: [], orders: [] } satisfies FloorBundle);
    }

    const columns = "id,room_id,customer_name,booking_code,start_time,end_time,status,guest_count,total_price,is_deposit_paid";
    const roomIds = rooms.map((room) => room.id);
    const [resResult, inRoomResult] = await Promise.all([
      db.from("reservations").select(columns).in("room_id", roomIds)
        .lt("start_time", window.endIso).gt("end_time", window.startIso)
        .not("status", "in", "(cancelled,no_show)").order("start_time"),
      // 已報到還沒結帳的客人不管預約時段（例如超時過了午夜）都還在包廂裡
      db.from("reservations").select(columns).in("room_id", roomIds).eq("status", "checked_in").limit(50),
    ]);
    if (resResult.error) throw resResult.error;
    if (inRoomResult.error) throw inRoomResult.error;
    const byId = new Map<string, FloorReservation>();
    for (const row of [...(resResult.data ?? []), ...(inRoomResult.data ?? [])] as FloorReservation[]) byId.set(row.id, row);
    const reservations = [...byId.values()].sort((a, b) => a.start_time.localeCompare(b.start_time));

    let orders: FloorOrderSummary[] = [];
    if (reservations.length > 0) {
      const orderResult = await db.from("orders")
        .select("reservation_id,total_amount,paid_at,order_items(quantity,served_at)")
        .in("reservation_id", reservations.map((r) => r.id));
      if (orderResult.error) throw orderResult.error;
      orders = (orderResult.data ?? []).map((order) => {
        const items = (order.order_items ?? []) as Array<{ quantity: number; served_at: string | null }>;
        return {
          reservation_id: order.reservation_id as string,
          total_amount: Number(order.total_amount) || 0,
          paid_at: (order.paid_at as string | null) ?? null,
          item_count: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
          unserved_count: items.filter((item) => !item.served_at).reduce((sum, item) => sum + (item.quantity || 0), 0),
        };
      });
    }

    return NextResponse.json({ date, generated_at: new Date().toISOString(), rooms, reservations, orders } satisfies FloorBundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法載入包廂場控";
    return NextResponse.json({ error: message }, { status: /invalid date/.test(message) ? 400 : 500 });
  }
}
