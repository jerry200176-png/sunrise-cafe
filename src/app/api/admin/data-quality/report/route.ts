import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured, fetchBranches, fetchRooms } from "@/lib/supabase-admin";
import {
  runReservationChecks,
  summarizeIssues,
  detectCancellationAnomaly,
  type ReservationRow,
} from "@/lib/data-quality";
import { toTaipei } from "@/lib/datetime";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const days = Math.min(90, Math.max(7, Number(request.nextUrl.searchParams.get("days") ?? "30")));

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabaseAdmin()
      .from("reservations")
      .select(
        "id, room_id, phone, start_time, end_time, status, is_deposit_paid, total_price, cancelled_at, cancelled_by, created_at"
      )
      .gte("created_at", since);

    if (error) throw error;

    const reservations = (rows ?? []) as ReservationRow[];
    const branches = await fetchBranches();
    const roomIds = new Set<string>();
    for (const b of branches as { id: string }[]) {
      const rooms = (await fetchRooms(b.id)) as { id: string }[];
      for (const r of rooms) roomIds.add(r.id);
    }

    const issues = runReservationChecks(reservations, roomIds);

    const today = toTaipei(new Date().toISOString());
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dayStart = `${todayStr}T00:00:00+08:00`;
    const dayEnd = `${todayStr}T23:59:59.999+08:00`;

    const { count: cancToday } = await supabaseAdmin()
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("status", "cancelled")
      .gte("cancelled_at", dayStart)
      .lte("cancelled_at", dayEnd);

    const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: canc30 } = await supabaseAdmin()
      .from("reservations")
      .select("id")
      .eq("status", "cancelled")
      .gte("cancelled_at", thirtyAgo);

    const baseline = (canc30?.length ?? 0) / 30;
    const spike = detectCancellationAnomaly(cancToday ?? 0, baseline);
    if (spike) issues.push(spike);

    const { count: analyticsCount } = await supabaseAdmin()
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);

    if (analyticsCount === 0) {
      issues.push({
        code: "analytics_empty",
        severity: "info",
        message: "analytics_events 無近期資料（可能未執行 migration）",
        count: 0,
      });
    }

    const { data: paidNoEvent } = await supabaseAdmin()
      .from("reservations")
      .select("id")
      .eq("is_deposit_paid", true)
      .gte("created_at", since)
      .limit(200);

    const summary = summarizeIssues(issues);

    return NextResponse.json({
      days,
      checked_reservations: reservations.length,
      summary,
      issues,
      sources: {
        reservations: reservations.length,
        analytics_events: analyticsCount ?? 0,
        deposit_paid_sample: paidNoEvent?.length ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "資料品質檢查失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
