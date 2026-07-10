import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured, fetchBranches, fetchRooms } from "@/lib/supabase-admin";
import { toTaipei } from "@/lib/datetime";
import { buildDemandSnapshots } from "@/lib/demand-signals";

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

function yesterdayTaipei(): string {
  const d = toTaipei(new Date().toISOString());
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const denied = await verifyCronOrAdmin(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date") || yesterdayTaipei();
  const dayStart = `${date}T00:00:00+08:00`;
  const dayEnd = `${date}T23:59:59.999+08:00`;

  try {
    const branches = (await fetchBranches()) as {
      id: string;
      open_time: string | null;
      close_time: string | null;
    }[];
    const rooms: { id: string; branch_id: string }[] = [];
    for (const b of branches) {
      const branchRooms = (await fetchRooms(b.id)) as { id: string }[];
      for (const r of branchRooms) {
        rooms.push({ id: r.id, branch_id: b.id });
      }
    }
    const roomBranch = new Map(rooms.map((r) => [r.id, r.branch_id]));

    const { data: resRows, error: resErr } = await supabaseAdmin()
      .from("reservations")
      .select("room_id, status, total_price, start_time, end_time, created_at, cancelled_at")
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd);

    if (resErr) throw resErr;

    const reservations = (resRows ?? []).map((r) => ({
      room_id: r.room_id as string,
      branch_id: roomBranch.get(r.room_id as string) ?? "",
      status: r.status as string,
      total_price: r.total_price as number | null,
      start_time: r.start_time as string,
      end_time: r.end_time as string,
      created_at: r.created_at as string,
      cancelled_at: r.cancelled_at as string | null,
    })).filter((r) => r.branch_id);

    const { data: waitlistRows } = await supabaseAdmin()
      .from("waitlist")
      .select("room_id, created_at")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    const { data: cancelRows } = await supabaseAdmin()
      .from("reservations")
      .select("room_id, cancelled_at")
      .eq("status", "cancelled")
      .gte("cancelled_at", dayStart)
      .lte("cancelled_at", dayEnd);

    const snapshots = buildDemandSnapshots({
      date,
      branches,
      rooms,
      reservations,
      waitlistJoins: (waitlistRows ?? []).map((w) => ({
        room_id: w.room_id as string,
        created_at: w.created_at as string,
      })),
      cancellations: (cancelRows ?? []).map((c) => ({
        room_id: c.room_id as string,
        cancelled_at: c.cancelled_at as string | null,
      })),
    });

    let upserted = 0;
    for (const snap of snapshots) {
      const { error } = await supabaseAdmin()
        .from("demand_snapshots")
        .upsert(snap, { onConflict: "snapshot_date,branch_id,room_id,hour" });
      if (!error) upserted += 1;
    }

    return NextResponse.json({
      ok: true,
      date,
      snapshots_built: snapshots.length,
      snapshots_upserted: upserted,
      migration_required: upserted === 0 && snapshots.length > 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "需求快照彙整失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
