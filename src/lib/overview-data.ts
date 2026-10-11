import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeBusiness,
  taipeiMonthRange,
  type MetricOrder,
  type MetricReservation,
} from "@/lib/business-metrics";

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** PostgREST 單次最多回 1000 筆，分頁取完，避免月底數字被悄悄截斷。 */
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export type RoomInfo = { id: string; name: string; branch_id: string; branch: { name: string } | { name: string }[] | null };
export type ReportReservation = MetricReservation & { room: RoomInfo | RoomInfo[] | null };
export type ReportOrder = MetricOrder & { created_at: string };

/**
 * 讀取 [from, to) 內的訂位（依開始時間）與訂單（依建立時間）。
 * scope：null = 不限分店；陣列 = 只這些分店（空陣列 = 沒有任何分店權限，不查詢）。
 */
export async function fetchReportRows(db: SupabaseClient, scope: string[] | null, from: string, to: string) {
  if (scope !== null && scope.length === 0) return { reservations: [] as ReportReservation[], orders: [] as ReportOrder[] };
  const reservations = await fetchAll<ReportReservation>((a, b) => {
    let q = db
      .from("reservations")
      .select("status,total_price,is_deposit_paid,guest_count,start_time,room:rooms!inner(id,name,branch_id,branch:branches(name))")
      .gte("start_time", from)
      .lt("start_time", to)
      .order("start_time")
      .range(a, b);
    if (scope) q = q.in("rooms.branch_id", scope);
    return q as unknown as Page<ReportReservation>;
  });
  const orders = await fetchAll<ReportOrder>((a, b) => {
    let q = db
      .from("orders")
      .select("status,total_amount,paid_at,created_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at")
      .range(a, b);
    if (scope) q = q.in("branch_id", scope);
    return q as unknown as Page<ReportOrder>;
  });
  return { reservations, orders };
}

const iso = (s: string) => new Date(s).toISOString();

/** scope 說明同 fetchReportRows。 */
export async function loadOverview(db: SupabaseClient, scope: string[] | null, now = new Date()) {
  const thisMonth = taipeiMonthRange(now, 0);
  const lastMonth = taipeiMonthRange(now, -1);
  const { reservations, orders } = await fetchReportRows(db, scope, lastMonth.from, thisMonth.to);
  const part = (r: { from: string; to: string; label: string }) => ({
    label: r.label,
    ...summarizeBusiness(
      reservations.filter((x) => iso(x.start_time) >= r.from && iso(x.start_time) < r.to),
      orders.filter((x) => iso(x.created_at) >= r.from && iso(x.created_at) < r.to),
      now
    ),
  });
  return { this_month: part(thisMonth), last_month: part(lastMonth) };
}
