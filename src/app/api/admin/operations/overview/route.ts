import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured, fetchBranches, fetchRooms } from "@/lib/supabase-admin";
import { toTaipei } from "@/lib/datetime";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function todayTaipeiDate(): string {
  const d = toTaipei(new Date().toISOString());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date") || todayTaipeiDate();
  const dayStart = `${date}T00:00:00+08:00`;
  const dayEnd = `${date}T23:59:59.999+08:00`;

  try {
    const branches = ((await fetchBranches()) ?? []) as { id: string; name: string }[];

    const { data: reservations } = await supabaseAdmin()
      .from("reservations")
      .select("id, status, start_time, total_price, is_deposit_paid, room_id, updated_at")
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd);

    const { data: cancelledToday } = await supabaseAdmin()
      .from("reservations")
      .select("id")
      .eq("status", "cancelled")
      .gte("updated_at", dayStart)
      .lte("updated_at", dayEnd);

    const { count: waitlistWaiting } = await supabaseAdmin()
      .from("waitlist")
      .select("id", { count: "exact", head: true })
      .eq("status", "waiting");

    const { count: waitlistNotified } = await supabaseAdmin()
      .from("waitlist")
      .select("id", { count: "exact", head: true })
      .eq("status", "notified");

    const roomBranchMap = new Map<string, string>();
    for (const b of branches) {
      const rooms = await fetchRooms(b.id);
      for (const r of rooms as { id: string }[]) {
        roomBranchMap.set(r.id, b.id);
      }
    }

    const rows = reservations ?? [];
    const active = rows.filter((r) => r.status !== "cancelled");
    const pendingDeposit = active.filter(
      (r) =>
        ["pending", "confirmed"].includes(r.status as string) && !r.is_deposit_paid
    );

    const byBranch = branches.map((b) => {
      const branchRes = active.filter((r) => roomBranchMap.get(r.room_id) === b.id);
      return {
        branch_id: b.id,
        branch_name: b.name,
        reservations: branchRes.length,
        revenue: Math.round(
          branchRes.reduce((s, r) => s + (Number(r.total_price) || 0), 0)
        ),
      };
    });

    return NextResponse.json({
      date,
      today: {
        reservations: active.length,
        revenue: Math.round(
          active.reduce((s, r) => s + (Number(r.total_price) || 0), 0)
        ),
        cancellations: cancelledToday?.length ?? 0,
        pending_deposit: pendingDeposit.length,
      },
      waitlist: {
        waiting: waitlistWaiting ?? 0,
        notified: waitlistNotified ?? 0,
      },
      by_branch: byBranch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入營運概覽";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
