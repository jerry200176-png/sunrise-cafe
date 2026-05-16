import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const months = Number(request.nextUrl.searchParams.get("months") ?? "6");
  const branchId = request.nextUrl.searchParams.get("branchId"); // 選填

  // 計算區間（台灣時間月份起始）
  const nowTW = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const fromDate = new Date(nowTW);
  fromDate.setMonth(fromDate.getMonth() - months + 1);
  fromDate.setDate(1);
  fromDate.setHours(0, 0, 0, 0);
  const from = fromDate.toISOString();

  try {
    let query = supabaseAdmin()
      .from("reservations")
      .select(`
        id, status, total_price, is_deposit_paid,
        start_time, end_time,
        room:rooms!inner(id, name, branch_id, branch:branches(name))
      `)
      .gte("start_time", from);

    if (branchId) query = query.eq("rooms.branch_id", branchId);

    const { data: rows, error } = await query;
    if (error) throw error;

    type Row = {
      id: string; status: string; total_price: number | null; is_deposit_paid: boolean;
      start_time: string; end_time: string;
      room: { id: string; name: string; branch_id: string; branch: { name: string }[] } | null;
    };
    const all = (rows ?? []) as unknown as Row[];

    const active = all.filter((r) => r.status !== "cancelled");
    const confirmed = active.filter((r) => r.status === "confirmed");
    const cancelled = all.filter((r) => r.status === "cancelled");

    // ── 總覽指標 ──────────────────────────────
    const totalRevenue = active.reduce((s, r) => s + (Number(r.total_price) || 0), 0);
    const depositPaid = confirmed.filter((r) => r.is_deposit_paid).length;

    const summary = {
      total_revenue: Math.round(totalRevenue),
      total_bookings: active.length,
      cancellation_count: cancelled.length,
      cancellation_rate: all.length ? +(cancelled.length / all.length).toFixed(3) : 0,
      deposit_paid_count: depositPaid,
      deposit_recovery_rate: confirmed.length ? +(depositPaid / confirmed.length).toFixed(3) : 0,
    };

    // ── 月份趨勢 ──────────────────────────────
    const monthlyMap: Record<string, { revenue: number; bookings: number }> = {};
    for (const r of active) {
      const d = new Date(new Date(r.start_time).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyMap[key]) monthlyMap[key] = { revenue: 0, bookings: 0 };
      monthlyMap[key].revenue += Number(r.total_price) || 0;
      monthlyMap[key].bookings += 1;
    }
    const monthly = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, revenue: Math.round(v.revenue), bookings: v.bookings }));

    // ── 包廂使用率 ────────────────────────────
    const roomMap: Record<string, { name: string; bookings: number; revenue: number }> = {};
    for (const r of active) {
      const roomId = r.room?.id ?? "unknown";
      const roomName = r.room?.name ?? "未知包廂";
      if (!roomMap[roomId]) roomMap[roomId] = { name: roomName, bookings: 0, revenue: 0 };
      roomMap[roomId].bookings += 1;
      roomMap[roomId].revenue += Number(r.total_price) || 0;
    }
    const by_room = Object.values(roomMap)
      .map((v) => ({ ...v, revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.bookings - a.bookings);

    // ── 熱門時段（每日幾點） ──────────────────
    const hourMap: Record<number, number> = {};
    for (const r of active) {
      const d = new Date(new Date(r.start_time).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const h = d.getHours();
      hourMap[h] = (hourMap[h] ?? 0) + 1;
    }
    const by_hour = Array.from({ length: 14 }, (_, i) => i + 8).map((h) => ({
      hour: h,
      label: `${h}:00`,
      count: hourMap[h] ?? 0,
    }));

    return NextResponse.json({ summary, monthly, by_room, by_hour });
  } catch (err) {
    const message = err instanceof Error ? err.message : "報表查詢失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
