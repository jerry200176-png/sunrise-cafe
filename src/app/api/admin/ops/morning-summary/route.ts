import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured, fetchBranches, fetchRooms } from "@/lib/supabase-admin";
import { toTaipei } from "@/lib/datetime";
import { buildOpsExceptions, formatMorningSummaryText } from "@/lib/ops-exceptions";
import { runReservationChecks, type ReservationRow } from "@/lib/data-quality";
import { branchOpenHoursPerDay, sumBookedHours, computeOccupancyRate, type ReservationKpiInput } from "@/lib/business-kpis";
import { isPaymentEventsTableReady } from "@/lib/payment-events-admin";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function todayTaipei(): string {
  const d = toTaipei(new Date().toISOString());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function buildContext(date: string) {
  const dayStart = `${date}T00:00:00+08:00`;
  const dayEnd = `${date}T23:59:59.999+08:00`;

  const { data: todayRes } = await supabaseAdmin()
    .from("reservations")
    .select("id, status, total_price, is_deposit_paid, room_id, start_time, end_time, phone, cancelled_at, cancelled_by")
    .gte("start_time", dayStart)
    .lte("start_time", dayEnd);

  const active = (todayRes ?? []).filter((r) => r.status !== "cancelled");
  const pendingDeposit = active.filter(
    (r) => ["pending", "confirmed"].includes(r.status as string) && !r.is_deposit_paid
  );

  const { count: waitlistWaiting } = await supabaseAdmin()
    .from("waitlist")
    .select("id", { count: "exact", head: true })
    .eq("status", "waiting");

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

  let paymentPending = 0;
  if (await isPaymentEventsTableReady()) {
    const { count } = await supabaseAdmin()
      .from("payment_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_review");
    paymentPending = count ?? 0;
  }

  const sevenSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: weekRes } = await supabaseAdmin()
    .from("reservations")
    .select("status, start_time, end_time, room_id")
    .gte("start_time", sevenSince);

  const branches = (await fetchBranches()) as {
    id: string;
    open_time: string | null;
    close_time: string | null;
  }[];
  let roomCount = 0;
  let hoursPerDay = 12;
  const roomIds = new Set<string>();
  for (const b of branches) {
    const rooms = (await fetchRooms(b.id)) as { id: string }[];
    roomCount += rooms.length;
    hoursPerDay = branchOpenHoursPerDay(b.open_time, b.close_time);
    for (const r of rooms) roomIds.add(r.id);
  }

  const weekActive = (weekRes ?? [])
    .filter((r) => r.status !== "cancelled")
    .map((r) => ({
      status: r.status as string,
      start_time: r.start_time as string,
      end_time: r.end_time as string,
      total_price: null,
    })) satisfies ReservationKpiInput[];
  const booked = sumBookedHours(weekActive);
  const occupancy = computeOccupancyRate(booked, roomCount * hoursPerDay * 7);

  const dqIssues = runReservationChecks(
    (todayRes ?? []) as ReservationRow[],
    roomIds
  );

  const exceptions = buildOpsExceptions({
    cancellations_today: cancToday ?? 0,
    cancellation_baseline: (canc30?.length ?? 0) / 30,
    occupancy_rate_7d: occupancy,
    pending_deposit: pendingDeposit.length,
    payment_pending_review: paymentPending,
    data_quality_issues: dqIssues,
  });

  return {
    date,
    today: {
      reservations: active.length,
      revenue: Math.round(
        active.reduce((s, r) => s + (Number(r.total_price) || 0), 0)
      ),
      pending_deposit: pendingDeposit.length,
      waitlist_waiting: waitlistWaiting ?? 0,
    },
    exceptions,
    line_message: formatMorningSummaryText({
      date,
      reservations_today: active.length,
      revenue_today: Math.round(
        active.reduce((s, r) => s + (Number(r.total_price) || 0), 0)
      ),
      pending_deposit: pendingDeposit.length,
      waitlist_waiting: waitlistWaiting ?? 0,
      exceptions,
    }),
  };
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date") || todayTaipei();

  try {
    const ctx = await buildContext(date);
    return NextResponse.json(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "晨報載入失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
