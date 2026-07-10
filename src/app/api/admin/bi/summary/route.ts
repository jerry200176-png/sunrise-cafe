import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { fetchAnalyticsSummary } from "@/lib/analytics-server";
import { isAdminConfigured, fetchBranches, fetchRooms } from "@/lib/supabase-admin";
import { toTaipei } from "@/lib/datetime";
import {
  branchOpenHoursPerDay,
  buildHourBuckets,
  computeCancellationBreakdown,
  computeCustomerReturnMetrics,
  computeFunnelConversion,
  computeNoShowRate,
  computeOccupancyRate,
  computeRevPerAvailableRoomHour,
  computeRoomUtilization,
  computeWaitlistRecovery,
  countNoShows,
  splitPeakOffPeak,
  sumBookedHours,
  sumRevenue,
} from "@/lib/business-kpis";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function taipeiHour(iso: string): number {
  return toTaipei(iso).getHours();
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

  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? "30")));
  const branchId = request.nextUrl.searchParams.get("branchId");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const today = todayTaipeiDate();
  const dayStart = `${today}T00:00:00+08:00`;
  const dayEnd = `${today}T23:59:59.999+08:00`;

  try {
    const branches = ((await fetchBranches()) ?? []) as {
      id: string;
      name: string;
      open_time: string | null;
      close_time: string | null;
    }[];

    const allRooms: { id: string; name: string; branch_id: string }[] = [];
    for (const b of branches) {
      if (branchId && b.id !== branchId) continue;
      const rooms = (await fetchRooms(b.id)) as { id: string; name: string }[];
      for (const r of rooms) {
        allRooms.push({ id: r.id, name: r.name, branch_id: b.id });
      }
    }

    const roomIds = allRooms.map((r) => r.id);
    if (branchId && roomIds.length === 0) {
      return NextResponse.json({ error: "分店無包廂" }, { status: 404 });
    }

    let resQuery = supabaseAdmin()
      .from("reservations")
      .select(
        "id, status, total_price, start_time, end_time, phone, room_id, created_at, updated_at"
      )
      .gte("start_time", since);

    if (roomIds.length > 0) {
      resQuery = resQuery.in("room_id", roomIds);
    }

    const { data: reservationRows, error: resErr } = await resQuery;
    if (resErr) throw resErr;

    const reservations = reservationRows ?? [];

    let todayQuery = supabaseAdmin()
      .from("reservations")
      .select("id, status, total_price, start_time, end_time, room_id")
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd);

    if (roomIds.length > 0) {
      todayQuery = todayQuery.in("room_id", roomIds);
    }

    const { data: todayRows } = await todayQuery;

    const todayActive = (todayRows ?? []).filter((r) => r.status !== "cancelled");

    const { data: waitlistRows } = await supabaseAdmin()
      .from("waitlist")
      .select("id, status, created_at, room_id")
      .gte("created_at", since);

    const waitlistFiltered =
      roomIds.length > 0
        ? (waitlistRows ?? []).filter((w) => roomIds.includes(w.room_id))
        : (waitlistRows ?? []);

    const relevantBranches = branchId
      ? branches.filter((b) => b.id === branchId)
      : branches;

    const hoursPerDay =
      relevantBranches.reduce(
        (sum, b) => sum + branchOpenHoursPerDay(b.open_time, b.close_time),
        0
      ) / Math.max(relevantBranches.length, 1);

    const roomCount = allRooms.length;
    const availableRoomHours = roomCount * hoursPerDay * days;
    const bookedHours = sumBookedHours(reservations);
    const revenue = sumRevenue(reservations);

    const cancellation = computeCancellationBreakdown(reservations);
    const nowMs = Date.now();
    const pastArrivals = reservations.filter(
      (r) =>
        new Date(r.start_time).getTime() < nowMs &&
        ["pending", "confirmed", "checked_in", "completed", "cancelled"].includes(r.status)
    );
    const expectedArrivals = pastArrivals.filter((r) => r.status !== "cancelled").length;
    const noShows = countNoShows(reservations, nowMs);

    const hourBuckets = buildHourBuckets(reservations, taipeiHour);
    const peakSplit = splitPeakOffPeak(hourBuckets, 11, 21);

    const hoursPerRoomInPeriod = hoursPerDay * days;
    const byRoom = computeRoomUtilization(
      reservations as { status: string; total_price: number | null; start_time: string; end_time: string; room_id: string }[],
      allRooms,
      hoursPerRoomInPeriod
    ).sort((a, b) => (b.utilization_rate ?? 0) - (a.utilization_rate ?? 0));

    const byBranch = relevantBranches.map((b) => {
      const branchRoomIds = new Set(
        allRooms.filter((r) => r.branch_id === b.id).map((r) => r.id)
      );
      const branchRes = reservations.filter((r) => branchRoomIds.has(r.room_id));
      const branchRoomCount = branchRoomIds.size;
      const branchHours = branchOpenHoursPerDay(b.open_time, b.close_time);
      const branchAvailable = branchRoomCount * branchHours * days;
      const branchBooked = sumBookedHours(branchRes);
      const branchRevenue = sumRevenue(branchRes);
      return {
        branch_id: b.id,
        branch_name: b.name,
        reservations: branchRes.filter((r) => r.status !== "cancelled").length,
        revenue: Math.round(branchRevenue),
        booked_hours: +branchBooked.toFixed(2),
        occupancy_rate: computeOccupancyRate(branchBooked, branchAvailable),
        rev_per_room_hour: computeRevPerAvailableRoomHour(branchRevenue, branchAvailable),
      };
    });

    let analytics = null;
    let funnelConversion = null;
    try {
      analytics = await fetchAnalyticsSummary(days);
      funnelConversion = computeFunnelConversion(analytics.funnel);
    } catch {
      // analytics_events table may not exist
    }

    const customers = computeCustomerReturnMetrics(
      reservations.map((r) => r.phone as string | null)
    );

    return NextResponse.json({
      days,
      branch_id: branchId,
      today: {
        date: today,
        reservations: todayActive.length,
        revenue: Math.round(
          todayActive.reduce((s, r) => s + (Number(r.total_price) || 0), 0)
        ),
      },
      kpis: {
        revenue: Math.round(revenue),
        booked_hours: +bookedHours.toFixed(2),
        available_room_hours: +availableRoomHours.toFixed(2),
        occupancy_rate: computeOccupancyRate(bookedHours, availableRoomHours),
        rev_per_available_room_hour: computeRevPerAvailableRoomHour(
          revenue,
          availableRoomHours
        ),
        cancellation_rate: cancellation.cancellation_rate,
        no_show_count: noShows,
        no_show_rate: computeNoShowRate(noShows, expectedArrivals),
        booking_conversion_rate: funnelConversion?.overall_conversion ?? null,
        customer_return_rate: customers.return_rate,
      },
      funnel: analytics?.funnel ?? null,
      funnel_conversion: funnelConversion,
      waitlist: computeWaitlistRecovery(waitlistFiltered),
      cancellation,
      customers,
      peak_off_peak: {
        peak_hours: [11, 21],
        ...peakSplit,
      },
      by_hour: hourBuckets,
      by_branch: byBranch,
      by_room: byRoom.slice(0, 20),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "BI 查詢失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
