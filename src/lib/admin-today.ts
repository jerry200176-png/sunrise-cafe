/**
 * Aggregate "今日場控" data for a single mobile-first admin screen.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchDashboardBundle } from "@/lib/admin-dashboard-data";
import {
  fetchPendingPaymentEvents,
  isPaymentEventsTableReady,
} from "@/lib/payment-events-admin";
import { computeDepositDeadline } from "@/lib/deposit-deadline";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type TodayOpsBundle = {
  date: string;
  branchId: string;
  generated_at: string;
  summary: {
    today_count: number;
    unpaid_deposit: number;
    pending_payment_reviews: number;
    arriving_soon: number;
    at_risk_deadline: number;
    waitlist_open: number;
    waitlist_needs_call: number;
  };
  timeline: Awaited<ReturnType<typeof fetchDashboardBundle>>["timeline"];
  upcoming: Array<{
    id: string;
    booking_code: string | null;
    customer_name: string;
    phone: string;
    room_name: string;
    start_time: string;
    end_time: string;
    status: string;
    is_deposit_paid: boolean;
    guest_confirmed_at: string | null;
    hours_until_start: number;
  }>;
  unpaid: Array<{
    id: string;
    booking_code: string | null;
    customer_name: string;
    phone: string;
    start_time: string;
    deposit_deadline: string | null;
    hours_to_deadline: number | null;
  }>;
  payment_reviews: Awaited<ReturnType<typeof fetchPendingPaymentEvents>>;
  waitlist: Array<{
    id: string;
    customer_name: string;
    phone: string;
    start_time: string;
    end_time: string;
    status: string;
    staff_alerted_at: string | null;
    staff_called_at: string | null;
    line_user_id: string | null;
  }>;
};

function taipeiDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function fetchTodayOpsBundle(
  branchId: string,
  date = taipeiDateKey()
): Promise<TodayOpsBundle> {
  const bundle = await fetchDashboardBundle(branchId, date);
  const now = Date.now();
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime();
  const dayEnd = dayStart + 24 * 3600_000;

  const rooms = bundle.timeline?.rooms ?? [];
  const roomNameById = new Map<string, string>();
  for (const r of rooms) {
    roomNameById.set(r.roomId, r.roomName);
  }

  // Reservations for branch today from stats source — re-query lightly
  const roomIds = rooms.map((r) => r.roomId);
  type ResRow = {
    id: string;
    booking_code: string | null;
    customer_name: string;
    phone: string;
    room_id: string;
    start_time: string;
    end_time: string;
    status: string;
    is_deposit_paid: boolean | null;
    guest_confirmed_at: string | null;
    created_at: string;
  };

  let todayRows: ResRow[] = [];
  if (roomIds.length > 0) {
    const { data } = await db()
      .from("reservations")
      .select(
        "id,booking_code,customer_name,phone,room_id,start_time,end_time,status,is_deposit_paid,guest_confirmed_at,created_at"
      )
      .in("room_id", roomIds)
      .gte("start_time", new Date(dayStart).toISOString())
      .lt("start_time", new Date(dayEnd).toISOString())
      .not("status", "eq", "cancelled")
      .order("start_time", { ascending: true });
    todayRows = (data ?? []) as ResRow[];
  }

  const upcoming = todayRows.map((r) => ({
    id: r.id,
    booking_code: r.booking_code,
    customer_name: r.customer_name,
    phone: r.phone,
    room_name: roomNameById.get(r.room_id) ?? "—",
    start_time: r.start_time,
    end_time: r.end_time,
    status: r.status,
    is_deposit_paid: Boolean(r.is_deposit_paid),
    guest_confirmed_at: r.guest_confirmed_at,
    hours_until_start: Math.round(((new Date(r.start_time).getTime() - now) / 3600_000) * 10) / 10,
  }));

  const unpaid = todayRows
    .filter((r) => !r.is_deposit_paid && ["pending", "confirmed", "reserved"].includes(r.status))
    .map((r) => {
      const deadline = computeDepositDeadline(r.created_at, r.start_time);
      const hours =
        deadline != null
          ? Math.round(((deadline.getTime() - now) / 3600_000) * 10) / 10
          : null;
      return {
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.customer_name,
        phone: r.phone,
        start_time: r.start_time,
        deposit_deadline: deadline?.toISOString() ?? null,
        hours_to_deadline: hours,
      };
    });

  let payment_reviews: Awaited<ReturnType<typeof fetchPendingPaymentEvents>> = [];
  if (await isPaymentEventsTableReady()) {
    payment_reviews = await fetchPendingPaymentEvents();
  }

  const { data: waitlistRaw } = await db()
    .from("waitlist")
    .select(
      "id,customer_name,phone,start_time,end_time,status,staff_alerted_at,staff_called_at,line_user_id,room_id"
    )
    .in("status", ["waiting", "notified"])
    .order("created_at", { ascending: true })
    .limit(40);

  const waitlist = ((waitlistRaw ?? []) as Array<{
    id: string;
    customer_name: string;
    phone: string;
    start_time: string;
    end_time: string;
    status: string;
    staff_alerted_at: string | null;
    staff_called_at: string | null;
    line_user_id: string | null;
    room_id: string;
  }>)
    .filter((w) => roomIds.length === 0 || roomIds.includes(w.room_id))
    .map((w) => ({
      id: w.id,
      customer_name: w.customer_name,
      phone: w.phone,
      start_time: w.start_time,
      end_time: w.end_time,
      status: w.status,
      staff_alerted_at: w.staff_alerted_at,
      staff_called_at: w.staff_called_at,
      line_user_id: w.line_user_id,
    }));

  const arriving_soon = upcoming.filter(
    (u) => u.hours_until_start >= 0 && u.hours_until_start <= 2
  ).length;
  const at_risk_deadline = unpaid.filter(
    (u) => u.hours_to_deadline != null && u.hours_to_deadline <= 6
  ).length;

  return {
    date,
    branchId,
    generated_at: new Date().toISOString(),
    summary: {
      today_count: upcoming.length,
      unpaid_deposit: unpaid.length,
      pending_payment_reviews: payment_reviews.length,
      arriving_soon,
      at_risk_deadline,
      waitlist_open: waitlist.length,
      waitlist_needs_call: waitlist.filter((w) => !w.line_user_id).length,
    },
    timeline: bundle.timeline,
    upcoming,
    unpaid,
    payment_reviews,
    waitlist,
  };
}
