import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import {
  summarizeBusiness,
  taipeiMonthRange,
  type MetricOrder,
  type MetricReservation,
} from "@/lib/business-metrics";

/** PostgREST 單次最多回 1000 筆，分頁取完，避免月底數字被悄悄截斷。 */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const branchId = request.nextUrl.searchParams.get("branchId"); // 沒給 = 全部分店
  const now = new Date();
  const thisMonth = taipeiMonthRange(now, 0);
  const lastMonth = taipeiMonthRange(now, -1);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const reservations = await fetchAll<MetricReservation>((a, b) => {
      let q = db
        .from("reservations")
        .select("status,total_price,is_deposit_paid,guest_count,start_time,room:rooms!inner(branch_id)")
        .gte("start_time", lastMonth.from)
        .lt("start_time", thisMonth.to)
        .order("start_time")
        .range(a, b);
      if (branchId) q = q.eq("rooms.branch_id", branchId);
      return q as unknown as PromiseLike<{ data: MetricReservation[] | null; error: { message: string } | null }>;
    });
    const orders = await fetchAll<MetricOrder & { created_at: string }>((a, b) => {
      let q = db
        .from("orders")
        .select("status,total_amount,paid_at,created_at")
        .gte("created_at", lastMonth.from)
        .lt("created_at", thisMonth.to)
        .order("created_at")
        .range(a, b);
      if (branchId) q = q.eq("branch_id", branchId);
      return q as unknown as PromiseLike<{ data: (MetricOrder & { created_at: string })[] | null; error: { message: string } | null }>;
    });

    const inRange = (iso: string, r: { from: string; to: string }) => iso >= r.from && iso < r.to;
    const part = (r: { from: string; to: string; label: string }) => ({
      label: r.label,
      ...summarizeBusiness(
        reservations.filter((x) => inRange(new Date(x.start_time).toISOString(), r)),
        orders.filter((x) => inRange(new Date(x.created_at).toISOString(), r)),
        now
      ),
    });
    return NextResponse.json({ this_month: part(thisMonth), last_month: part(lastMonth) });
  } catch {
    return NextResponse.json({ error: "經營總覽暫時讀不到，請重試" }, { status: 500 });
  }
}
