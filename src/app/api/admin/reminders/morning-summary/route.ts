import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured, fetchBranches } from "@/lib/supabase-admin";
import { toTaipei } from "@/lib/datetime";
import { buildOpsExceptions, formatMorningSummaryText } from "@/lib/ops-exceptions";
import { runReservationChecks, type ReservationRow } from "@/lib/data-quality";
import { branchOpenHoursPerDay, sumBookedHours, computeOccupancyRate, type ReservationKpiInput } from "@/lib/business-kpis";
import { isPaymentEventsTableReady } from "@/lib/payment-events-admin";
import { sendLineMessageToGroup, sendLineMessage, isLineConfigured } from "@/lib/line-notify";

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

function todayTaipei(): string {
  const d = toTaipei(new Date().toISOString());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type BranchRow = { id: string; name: string; line_group_id?: string | null; open_time?: string | null; close_time?: string | null };

async function buildMorningContext(date: string) {
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

  const branches = (await fetchBranches()) as BranchRow[];
  let roomCount = 0;
  let hoursPerDay = 12;
  const roomIds = new Set<string>();
  for (const b of branches) {
    const { data: rooms } = await supabaseAdmin().from("rooms").select("id").eq("branch_id", b.id);
    roomCount += (rooms ?? []).length;
    hoursPerDay = branchOpenHoursPerDay(b.open_time ?? null, b.close_time ?? null);
    for (const r of rooms ?? []) roomIds.add(r.id as string);
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

  const dqIssues = runReservationChecks((todayRes ?? []) as ReservationRow[], roomIds);

  const exceptions = buildOpsExceptions({
    cancellations_today: cancToday ?? 0,
    cancellation_baseline: (canc30?.length ?? 0) / 30,
    occupancy_rate_7d: occupancy,
    pending_deposit: pendingDeposit.length,
    payment_pending_review: paymentPending,
    data_quality_issues: dqIssues,
  });

  const line_message = formatMorningSummaryText({
    date,
    reservations_today: active.length,
    revenue_today: Math.round(active.reduce((s, r) => s + (Number(r.total_price) || 0), 0)),
    pending_deposit: pendingDeposit.length,
    waitlist_waiting: waitlistWaiting ?? 0,
    exceptions,
  });

  return { date, line_message, branches };
}

export async function GET(request: NextRequest) {
  const denied = await verifyCronOrAdmin(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date") || todayTaipei();
  const push = request.nextUrl.searchParams.get("push") !== "0";

  try {
    const ctx = await buildMorningContext(date);
    const results: { target: string; ok: boolean; error?: string }[] = [];

    if (push) {
      const activeBranches = ctx.branches.filter((b) => b.line_group_id);
      const useLegacy = activeBranches.length === 0;

      if (useLegacy) {
        if (isLineConfigured()) {
          try {
            await sendLineMessage(ctx.line_message);
            results.push({ target: "legacy_group", ok: true });
          } catch (err) {
            results.push({
              target: "legacy_group",
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          results.push({ target: "legacy_group", ok: false, error: "LINE 未設定" });
        }
      } else {
        for (const b of activeBranches) {
          try {
            const text = `【${b.name}】\n${ctx.line_message}`;
            await sendLineMessageToGroup(text, b.line_group_id!);
            results.push({ target: b.name, ok: true });
          } catch (err) {
            results.push({
              target: b.name,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      date: ctx.date,
      line_message: ctx.line_message,
      pushed: push,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "晨報推播失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
