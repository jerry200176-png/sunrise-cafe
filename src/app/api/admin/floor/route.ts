import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { isAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { taipeiDateKey, taipeiDayWindow } from "@/lib/admin-today";
import { UPCOMING_MINUTES, type FloorReservation } from "@/lib/room-checkout";

/** 回看多久內結帳完的組（跨午夜時仍顯示還沒送的餐／沒收的餐費） */
const RECENT_COMPLETED_HOURS = 6;
/** 已結帳或報到後取消、但餐費還沒收的組，不論預約時段多早結束都留在場控上（訂位沒有結帳時間欄位，只能用時段回看） */
const UNPAID_LOOKBACK_DAYS = 7;

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
    const [resResult, inRoomResult, recentResult, unpaidResult, cancelledResult] = await Promise.all([
      db.from("reservations").select(columns).in("room_id", roomIds)
        // 往後多抓「即將到店」的時間，午夜前也看得到 00:xx 進場的下一組
        .lt("start_time", new Date(window.endMs + UPCOMING_MINUTES * 60_000).toISOString()).gt("end_time", window.startIso)
        .not("status", "in", "(cancelled,no_show)").order("start_time"),
      // 已報到還沒結帳的客人不管預約時段（例如超時過了午夜）都還在包廂裡
      db.from("reservations").select(columns).in("room_id", roomIds).eq("status", "checked_in").limit(50),
      // 剛結帳完（可能跨午夜）的組，可能還有沒送的餐或沒收的餐費
      db.from("reservations").select(columns).in("room_id", roomIds).eq("status", "completed")
        .gt("end_time", new Date(window.startMs - RECENT_COMPLETED_HOURS * 3_600_000).toISOString()).limit(50),
      // 餐費還沒收的組：超時很久才結帳（預約時段早已結束），或報到後被取消（訂單還在）
      db.from("reservations").select(`${columns},orders!inner(paid_at)`).in("room_id", roomIds).in("status", ["completed", "cancelled"])
        .is("orders.paid_at", null)
        .gt("end_time", new Date(window.startMs - UNPAID_LOOKBACK_DAYS * 86_400_000).toISOString()).limit(50),
      // 報到後被取消、但還有現場訂單的組（可能餐費已收但還有餐沒送）；畫面只顯示還沒處理完的
      db.from("reservations").select(`${columns},orders!inner(id)`).in("room_id", roomIds).eq("status", "cancelled")
        .gt("end_time", new Date(window.startMs - UNPAID_LOOKBACK_DAYS * 86_400_000).toISOString()).limit(50),
    ]);
    if (resResult.error) throw resResult.error;
    if (inRoomResult.error) throw inRoomResult.error;
    if (recentResult.error) throw recentResult.error;
    if (unpaidResult.error) throw unpaidResult.error;
    if (cancelledResult.error) throw cancelledResult.error;
    const unpaidRows = ([...(unpaidResult.data ?? []), ...(cancelledResult.data ?? [])] as Array<FloorReservation & { orders?: unknown }>)
      .map((row) => { const copy = { ...row }; delete copy.orders; return copy as FloorReservation; });
    const byId = new Map<string, FloorReservation>();
    for (const row of [...(resResult.data ?? []), ...(inRoomResult.data ?? []), ...(recentResult.data ?? []), ...unpaidRows] as FloorReservation[]) {
      byId.set(row.id, row);
    }
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
