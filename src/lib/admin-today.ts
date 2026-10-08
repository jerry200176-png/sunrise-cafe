/**
 * Aggregate "今日場控" data for a single mobile-first admin screen.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchDashboardBundle } from "@/lib/admin-dashboard-data";
import {
  fetchPendingPaymentEvents,
  isPaymentEventsTableReady,
  type PendingPaymentEvent,
} from "@/lib/payment-events-admin";
import { computeDepositDeadline } from "@/lib/deposit-deadline";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type TodayOpsPartialError = {
  source: "payment_events" | "waitlist" | "timeline";
  message: string;
};

export type TodayOpsBundle = {
  date: string;
  branchId: string;
  generated_at: string;
  timezone: "Asia/Taipei";
  window: { start_iso: string; end_iso: string };
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
  payment_reviews: PendingPaymentEvent[];
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
  partial_errors: TodayOpsPartialError[];
  /** Documented hop-count for peak tasks vs previous multi-page flow */
  task_hops: {
    review_payment: { before: number; after: number };
    call_unpaid: { before: number; after: number };
    call_waitlist: { before: number; after: number };
  };
};

/** Taipei calendar date YYYY-MM-DD */
export function taipeiDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Inclusive Taipei day window as UTC instants. */
export function taipeiDayWindow(date: string): { startMs: number; endMs: number; startIso: string; endIso: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("invalid date (expect YYYY-MM-DD Taipei calendar)");
  }
  const startMs = new Date(`${date}T00:00:00+08:00`).getTime();
  const endMs = startMs + 24 * 3600_000;
  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/** Pure filter helpers (unit-tested). */
export function filterPaymentReviewsForBranch(
  reviews: PendingPaymentEvent[],
  reservationIds: Set<string>
): PendingPaymentEvent[] {
  return reviews.filter((r) => reservationIds.has(r.reservation_id));
}

export function isWithinTaipeiDay(startIso: string, date: string): boolean {
  const { startMs, endMs } = taipeiDayWindow(date);
  const t = new Date(startIso).getTime();
  return t >= startMs && t < endMs;
}

export async function fetchTodayOpsBundle(
  branchId: string,
  date = taipeiDateKey()
): Promise<TodayOpsBundle> {
  const window = taipeiDayWindow(date);
  const partial_errors: TodayOpsPartialError[] = [];
  const now = Date.now();

  let bundle: Awaited<ReturnType<typeof fetchDashboardBundle>>;
  try {
    bundle = await fetchDashboardBundle(branchId, date);
  } catch (e) {
    partial_errors.push({
      source: "timeline",
      message: e instanceof Error ? e.message : "timeline failed",
    });
    bundle = {
      date,
      stats: {
        date,
        todayCount: 0,
        todayRevenue: 0,
        roomsInUseCount: 0,
        totalRooms: 0,
      },
      timeline: {
        date,
        branchName: "",
        openTime: "09:00",
        closeTime: "21:00",
        rooms: [],
      },
      trend: { endDate: date, points: [] },
    };
  }

  const rooms = bundle.timeline?.rooms ?? [];
  const roomNameById = new Map<string, string>();
  for (const r of rooms) {
    roomNameById.set(r.roomId, r.roomName);
  }
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
    const { data, error } = await db()
      .from("reservations")
      .select(
        "id,booking_code,customer_name,phone,room_id,start_time,end_time,status,is_deposit_paid,guest_confirmed_at,created_at"
      )
      .in("room_id", roomIds)
      .gte("start_time", window.startIso)
      .lt("start_time", window.endIso)
      .not("status", "eq", "cancelled")
      .order("start_time", { ascending: true });
    if (error) {
      partial_errors.push({ source: "timeline", message: error.message });
    } else {
      todayRows = (data ?? []) as ResRow[];
    }
  }

  const reservationIds = new Set(todayRows.map((r) => r.id));

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
    .filter((r) => !r.is_deposit_paid && ["pending", "confirmed"].includes(r.status))
    .map((r) => {
      const deadline = computeDepositDeadline(r.created_at, r.start_time);
      const hours = Math.round(((deadline.getTime() - now) / 3600_000) * 10) / 10;
      return {
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.customer_name,
        phone: r.phone,
        start_time: r.start_time,
        deposit_deadline: deadline.toISOString(),
        hours_to_deadline: hours,
      };
    });

  let payment_reviews: PendingPaymentEvent[] = [];
  try {
    if (await isPaymentEventsTableReady()) {
      const all = await fetchPendingPaymentEvents();
      // Branch isolation: only reservations belonging to this branch's today's rooms
      // Also include pending for this branch even if not "today" — filter by room via reservation ids of branch
      // Re-query branch reservation pending below if needed — use all pending whose reservation is in this branch.
      const branchReservationIds = new Set(todayRows.map((r) => r.id));
      // Expand: any pending tied to branch rooms (not only today)
      if (roomIds.length > 0) {
        const { data: branchRes } = await db()
          .from("reservations")
          .select("id")
          .in("room_id", roomIds)
          .limit(500);
        for (const row of branchRes ?? []) {
          branchReservationIds.add(row.id as string);
        }
      }
      payment_reviews = filterPaymentReviewsForBranch(all, branchReservationIds);
      void reservationIds;
    }
  } catch (e) {
    partial_errors.push({
      source: "payment_events",
      message: e instanceof Error ? e.message : "payment_events failed",
    });
  }

  let waitlist: TodayOpsBundle["waitlist"] = [];
  try {
    const { data: waitlistRaw, error } = await db()
      .from("waitlist")
      .select(
        "id,customer_name,phone,start_time,end_time,status,staff_alerted_at,staff_called_at,line_user_id,room_id"
      )
      .in("status", ["waiting", "notified"])
      .order("created_at", { ascending: true })
      .limit(40);
    if (error) throw error;
    waitlist = ((waitlistRaw ?? []) as Array<{
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
  } catch (e) {
    partial_errors.push({
      source: "waitlist",
      message: e instanceof Error ? e.message : "waitlist failed",
    });
  }

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
    timezone: "Asia/Taipei",
    window: { start_iso: window.startIso, end_iso: window.endIso },
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
    partial_errors,
    task_hops: {
      // before: dashboard → payments → back → tables (≈4 navigations)
      review_payment: { before: 4, after: 1 },
      call_unpaid: { before: 3, after: 1 },
      call_waitlist: { before: 3, after: 1 },
    },
  };
}
