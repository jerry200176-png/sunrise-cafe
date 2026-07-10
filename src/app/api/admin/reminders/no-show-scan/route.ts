import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { toTaipei } from "@/lib/datetime";
import { countNoShows } from "@/lib/business-kpis";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function verifyCronOrAdmin(request: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return Promise.resolve(null);
  }
  return requireAdminApiAuth(request);
}

/**
 * Advisory no-show scan — does NOT auto-cancel or penalize guests.
 * Operators use dashboard KPIs + reservation list to follow up.
 */
export async function GET(request: NextRequest) {
  const denied = await verifyCronOrAdmin(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const graceMinutes = Number(request.nextUrl.searchParams.get("grace_min") ?? "30");
  const nowMs = Date.now();
  const today = toTaipei(new Date().toISOString());
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const dayStart = `${y}-${m}-${d}T00:00:00+08:00`;
  const dayEnd = `${y}-${m}-${d}T23:59:59.999+08:00`;

  try {
    const { data, error } = await supabaseAdmin()
      .from("reservations")
      .select("id, booking_code, customer_name, status, start_time, end_time, room_id")
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd)
      .in("status", ["pending", "confirmed", "checked_in", "completed", "cancelled"]);

    if (error) throw error;

    const rows = data ?? [];
    const probable = rows.filter((r) =>
      countNoShows([r], nowMs, graceMinutes) === 1
    );

    return NextResponse.json({
      date: `${y}-${m}-${d}`,
      grace_minutes: graceMinutes,
      scanned: rows.length,
      probable_no_shows: probable.length,
      samples: probable.slice(0, 10).map((r) => ({
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.customer_name,
        start_time: r.start_time,
        status: r.status,
      })),
      note: "僅供營運參考；請人工確認後再於後台更新狀態。",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "no-show 掃描失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
