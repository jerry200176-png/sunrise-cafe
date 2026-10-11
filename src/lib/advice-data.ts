import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdvice, type AdviceResult, type BranchMetrics } from "@/lib/business-advice";
import { fetchAll } from "@/lib/overview-data";

const DAY = 86_400_000;
const WINDOW_DAYS = 28;

type Room = { id: string; name: string; branch_id: string; branch: { name: string } | { name: string }[] | null };
export type AdviceRow = {
  status: string;
  total_price: number | null;
  is_deposit_paid: boolean | null;
  start_time: string;
  phone: string | null;
  room: Room | Room[] | null;
  preorder?: { status: string } | { status: string }[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const taipeiHour = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).getUTCHours();

/** 純函式：訂位列 → 每間分店的指標。只算店員標記的「沒來」。 */
export function toBranchMetrics(rows: AdviceRow[]): BranchMetrics[] {
  const byBranch = new Map<string, { m: BranchMetrics; price: number; phones: Map<string, number> }>();
  for (const r of rows) {
    const room = one(r.room);
    if (!room) continue;
    let e = byBranch.get(room.branch_id);
    if (!e) {
      e = {
        m: {
          branchId: room.branch_id, branchName: one(room.branch)?.name ?? "分店", bookings: 0, cancelled: 0, cancelledUnpaid: 0, noShows: 0,
          depositPaid: 0, avgPrice: 0, hourBookings: Array(24).fill(0), rooms: [], uniqueGuests: 0, repeatGuests: 0, preorderBookings: 0,
        },
        price: 0,
        phones: new Map(),
      };
      byBranch.set(room.branch_id, e);
    }
    const { m } = e;
    if (r.status === "cancelled" || r.status === "rejected") {
      m.cancelled++;
      if (!r.is_deposit_paid) m.cancelledUnpaid++;
      continue;
    }
    m.bookings++;
    e.price += Number(r.total_price ?? 0);
    if (r.status === "no_show") m.noShows++;
    if (r.is_deposit_paid) m.depositPaid++;
    m.hourBookings[taipeiHour(r.start_time)]++;
    const slot = m.rooms.find((x) => x.id === room.id) ?? (m.rooms[m.rooms.push({ id: room.id, name: room.name, bookings: 0 }) - 1]);
    slot.bookings++;
    const p = one(r.preorder)?.status;
    if (p === "submitted" || p === "locked") m.preorderBookings++;
    if (r.phone) e.phones.set(r.phone, (e.phones.get(r.phone) ?? 0) + 1);
  }
  return [...byBranch.values()].map(({ m, price, phones }) => ({
    ...m,
    avgPrice: m.bookings ? price / m.bookings : 0,
    uniqueGuests: phones.size,
    repeatGuests: [...phones.values()].filter((n) => n >= 2).length,
  }));
}

/** scope：null = 不限分店；陣列 = 只這些分店（和經營總覽相同；空陣列 = 沒有權限）。 */
export async function loadAdvice(db: SupabaseClient, scope: string[] | null, now = new Date()): Promise<AdviceResult> {
  if (scope !== null && scope.length === 0) return buildAdvice({ weeksCovered: 0, branches: [] });
  const from = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
  const rows = await fetchAll<AdviceRow>((a, b) => {
    let q = db
      .from("reservations")
      .select("status,total_price,is_deposit_paid,start_time,phone,room:rooms!inner(id,name,branch_id,branch:branches(name)),preorder:reservation_preorders(status)")
      .gte("start_time", from)
      .lt("start_time", now.toISOString())
      .order("start_time")
      .range(a, b);
    if (scope) q = q.in("rooms.branch_id", scope);
    return q as never;
  });
  let first = db.from("reservations").select("start_time,room:rooms!inner(branch_id)").order("start_time").limit(1);
  if (scope) first = first.in("rooms.branch_id", scope);
  const { data: earliest, error } = await first;
  if (error) throw new Error(error.message);
  const t = earliest?.[0]?.start_time ? new Date(earliest[0].start_time).getTime() : now.getTime();
  return buildAdvice({ weeksCovered: Math.floor((now.getTime() - t) / (7 * DAY)), branches: toBranchMetrics(rows) });
}
