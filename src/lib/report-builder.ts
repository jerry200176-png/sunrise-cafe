import { summarizeBusiness, taipeiMonthRange, type BusinessSummary } from "@/lib/business-metrics";
import type { ReportOrder, ReportReservation, RoomInfo } from "@/lib/overview-data";

const DEAD = new Set(["cancelled", "rejected"]);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
/** 台灣當地的小時（沒有夏令時間，固定 +8）。 */
const taipeiHour = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).getUTCHours();

export type ReportPayload = {
  summary: BusinessSummary & { cancellation_count: number; cancellation_rate: number };
  monthly: { month: string; label: string; bookings: number; received_deposits: number; received_orders: number }[];
  by_room: { name: string; bookings: number; booked_amount: number }[];
  by_hour: { hour: number; label: string; count: number }[];
};

/** months：含本月往前共幾個月。 */
export function buildReport(
  reservations: ReportReservation[],
  orders: ReportOrder[],
  months: number,
  now: Date,
  multiBranch: boolean
): ReportPayload {
  const base = summarizeBusiness(reservations, orders, now);
  const total = reservations.length;

  const monthly = Array.from({ length: months }, (_, i) => {
    const r = taipeiMonthRange(now, -(months - 1 - i));
    const s = summarizeBusiness(
      reservations.filter((x) => new Date(x.start_time).toISOString() >= r.from && new Date(x.start_time).toISOString() < r.to),
      orders.filter((x) => new Date(x.created_at).toISOString() >= r.from && new Date(x.created_at).toISOString() < r.to),
      now
    );
    const key = new Date(Date.parse(r.from) + 8 * 3600_000).toISOString().slice(0, 7);
    return { month: key, label: r.label, bookings: s.bookings, received_deposits: s.received_deposits, received_orders: s.received_orders };
  });

  const rooms = new Map<string, { name: string; bookings: number; booked_amount: number }>();
  const hours = new Map<number, number>();
  for (const r of reservations) {
    if (DEAD.has(r.status)) continue;
    const room = one<RoomInfo>(r.room);
    const branch = one(room?.branch);
    const name = room ? (multiBranch && branch?.name ? `${branch.name} ${room.name}` : room.name) : "未知包廂";
    const cur = rooms.get(room?.id ?? "unknown") ?? { name, bookings: 0, booked_amount: 0 };
    cur.bookings += 1;
    // 在包廂裡結帳（kind=full）的組用結帳紀錄的包廂費（含延長）；其餘照預約總價。
    // food_only 只是事後補收餐費（room_fee 一律 0），不能把沒走結帳流程就完成的組的包廂收入歸零
    const settled = one(r.settlement);
    cur.booked_amount += Number(settled?.kind === "full" ? settled.room_fee : r.total_price) || 0;
    rooms.set(room?.id ?? "unknown", cur);
    const h = taipeiHour(r.start_time);
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }

  return {
    summary: {
      ...base,
      cancellation_count: base.cancelled,
      cancellation_rate: total ? Math.round((base.cancelled / total) * 1000) / 1000 : 0,
    },
    monthly,
    by_room: [...rooms.values()].sort((a, b) => b.bookings - a.bookings),
    by_hour: Array.from({ length: 14 }, (_, i) => i + 8).map((h) => ({ hour: h, label: `${h}:00`, count: hours.get(h) ?? 0 })),
  };
}
