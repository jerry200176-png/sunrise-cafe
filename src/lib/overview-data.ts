import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeBusiness,
  taipeiMonthRange,
  type MetricOrder,
  type MetricReservation,
} from "@/lib/business-metrics";

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** PostgREST 單次最多回 1000 筆，分頁取完，避免月底數字被悄悄截斷。 */
async function fetchAll<T>(page: (from: number, to: number) => Page<T>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** scope：null = 不限分店；陣列 = 只算這些分店（空陣列 = 沒有任何分店權限）。 */
export async function loadOverview(db: SupabaseClient, scope: string[] | null, now = new Date()) {
  const thisMonth = taipeiMonthRange(now, 0);
  const lastMonth = taipeiMonthRange(now, -1);

  let reservations: MetricReservation[] = [];
  let orders: (MetricOrder & { created_at: string })[] = [];
  if (scope === null || scope.length > 0) {
    reservations = await fetchAll<MetricReservation>((a, b) => {
      let q = db
        .from("reservations")
        .select("status,total_price,is_deposit_paid,guest_count,start_time,room:rooms!inner(branch_id)")
        .gte("start_time", lastMonth.from)
        .lt("start_time", thisMonth.to)
        .order("start_time")
        .range(a, b);
      if (scope) q = q.in("rooms.branch_id", scope);
      return q as unknown as Page<MetricReservation>;
    });
    orders = await fetchAll<MetricOrder & { created_at: string }>((a, b) => {
      let q = db
        .from("orders")
        .select("status,total_amount,paid_at,created_at")
        .gte("created_at", lastMonth.from)
        .lt("created_at", thisMonth.to)
        .order("created_at")
        .range(a, b);
      if (scope) q = q.in("branch_id", scope);
      return q as unknown as Page<MetricOrder & { created_at: string }>;
    });
  }

  const inRange = (iso: string, r: { from: string; to: string }) => iso >= r.from && iso < r.to;
  const part = (r: { from: string; to: string; label: string }) => ({
    label: r.label,
    ...summarizeBusiness(
      reservations.filter((x) => inRange(new Date(x.start_time).toISOString(), r)),
      orders.filter((x) => inRange(new Date(x.created_at).toISOString(), r)),
      now
    ),
  });
  return { this_month: part(thisMonth), last_month: part(lastMonth) };
}
