/**
 * Shared admin dashboard data — single fetch, multiple views (ADM-005b).
 */
import { fetchBranch, fetchRooms } from "@/lib/supabase-admin";
import { fetchReservationsOverlapping, type TimeWindow } from "@/lib/reservation-list-query";

export type DashboardReservation = {
  id?: string;
  booking_code?: string | null;
  room_id: string;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  customer_name: string;
  guest_count?: number | null;
  is_deposit_paid?: boolean | null;
};

export type DashboardRoom = {
  id: string;
  name: string;
};

export type DashboardBranch = {
  name: string;
  open_time: string | null;
  close_time: string | null;
} | null;

export type DashboardStats = {
  date: string;
  todayCount: number;
  todayRevenue: number;
  roomsInUseCount: number;
  roomsBookedCount?: number;
  totalRooms: number;
};

export type DashboardTrendPoint = {
  date: string;
  count: number;
  revenue: number;
};

export type DashboardTimelineRoom = {
  roomId: string;
  roomName: string;
  reservations: {
    id?: string;
    booking_code?: string | null;
    start_time: string;
    end_time: string;
    customer_name: string;
    status: string;
    total_price: number | null;
    guest_count?: number | null;
    is_deposit_paid?: boolean | null;
  }[];
};

export type DashboardTimeline = {
  date: string;
  branchName: string;
  openTime: string;
  closeTime: string;
  rooms: DashboardTimelineRoom[];
};

export type DashboardBundle = {
  date: string;
  stats: DashboardStats;
  timeline: DashboardTimeline;
  trend: { endDate: string; points: DashboardTrendPoint[] };
};

function dayRange(date: string) {
  // Supabase timestamps are UTC, but the staff workflow is organized by
  // Taipei calendar days.  A UTC range is off by one day around 16:00 UTC.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("invalid date (expect YYYY-MM-DD)");
  }
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("invalid date (expect YYYY-MM-DD)");
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export const TREND_DAYS = 7;

/** 後台日期參數（台北日曆日 YYYY-MM-DD）；不合格的由 API 回 400，而不是查詢時才炸成 500。 */
export function isDashboardDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return !Number.isNaN(new Date(`${date}T00:00:00+08:00`).getTime());
}

export type DashboardView = "stats" | "timeline" | "trend" | "bundle";

/**
 * 每個畫面實際需要的時間窗（以「與窗重疊」查訂位）：
 *   - timeline：那一天（台北）
 *   - trend：結束日往前 7 天（台北）
 *   - stats：那一天，加上「現在」（使用中包廂；查別天時現在可能不在那一天）
 *   - bundle：7 天趨勢窗（已含那一天），加上「現在」
 * 「現在」已落在其他窗內時不重複查。
 */
export function dashboardWindows(view: DashboardView, date: string, now = new Date()): TimeWindow[] {
  const day = dayRange(date);
  const dayWindow = { fromIso: day.start, toIso: day.end };
  const trendWindow = { fromIso: dayRange(lastNDays(date, TREND_DAYS)[0]).start, toIso: day.end };
  const nowIso = now.toISOString();
  const nowWindow = { fromIso: nowIso, toIso: new Date(now.getTime() + 1).toISOString() };
  const withNow = (w: TimeWindow) => (nowIso >= w.fromIso && nowIso < w.toIso ? [w] : [w, nowWindow]);
  switch (view) {
    case "timeline":
      return [dayWindow];
    case "trend":
      return [trendWindow];
    case "stats":
      return withNow(dayWindow);
    case "bundle":
      return withNow(trendWindow);
  }
}

function lastNDays(endDate: string, n: number): string[] {
  const end = new Date(`${endDate}T12:00:00.000Z`);
  return Array.from({ length: n }, (_, idx) => {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - (n - 1 - idx));
    return d.toISOString().slice(0, 10);
  });
}

export function buildDashboardStats(
  date: string,
  reservations: DashboardReservation[],
  rooms: DashboardRoom[],
  now = new Date()
): DashboardStats {
  const { start: dayStart, end: dayEnd } = dayRange(date);
  const nowIso = now.toISOString();

  const todayList = reservations.filter(
    (r) => r.status !== "cancelled" && r.start_time >= dayStart && r.start_time < dayEnd
  );
  const inUseNow = reservations.filter(
    (r) =>
      r.status !== "cancelled" &&
      r.status !== "completed" &&
      r.start_time <= nowIso &&
      r.end_time > nowIso
  );
  const bookedOnDate = reservations.filter(
    (r) =>
      r.status !== "cancelled" &&
      r.start_time < dayEnd &&
      r.end_time > dayStart
  );

  return {
    date,
    todayCount: todayList.length,
    todayRevenue: Math.round(
      todayList.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0)
    ),
    roomsInUseCount: new Set(inUseNow.map((r) => r.room_id)).size,
    roomsBookedCount: new Set(bookedOnDate.map((r) => r.room_id)).size,
    totalRooms: rooms.length,
  };
}

export function buildDashboardTimeline(
  date: string,
  reservations: DashboardReservation[],
  rooms: DashboardRoom[],
  branch: DashboardBranch
): DashboardTimeline {
  const { start: dayStart, end: dayEnd } = dayRange(date);

  const roomList = rooms.map((rm) => {
    const dayReservations = reservations.filter(
      (r) => r.room_id === rm.id && r.start_time < dayEnd && r.end_time > dayStart
    );
    return {
      roomId: rm.id,
      roomName: rm.name,
      reservations: dayReservations.map((r) => ({
        id: r.id,
        booking_code: r.booking_code,
        start_time: r.start_time,
        end_time: r.end_time,
        customer_name: r.customer_name,
        status: r.status,
        total_price: r.total_price,
        guest_count: r.guest_count,
        is_deposit_paid: r.is_deposit_paid,
      })),
    };
  });

  return {
    date,
    branchName: branch?.name ?? "",
    openTime: branch?.open_time ?? "09:00",
    closeTime: branch?.close_time ?? "21:00",
    rooms: roomList,
  };
}

export function buildDashboardTrend(
  endDate: string,
  reservations: DashboardReservation[],
  days = TREND_DAYS
): { endDate: string; points: DashboardTrendPoint[] } {
  const dayList = lastNDays(endDate, days);

  const points = dayList.map((date) => {
    const { start, end } = dayRange(date);
    const filtered = reservations.filter(
      (r) => r.status !== "cancelled" && r.start_time >= start && r.start_time < end
    );
    return {
      date,
      count: filtered.length,
      revenue: Math.round(
        filtered.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0)
      ),
    };
  });

  return { endDate, points };
}

export async function fetchDashboardBundle(
  branchId: string,
  date: string,
  now = new Date()
): Promise<DashboardBundle> {
  const [reservationsRaw, roomsRaw, branch] = await Promise.all([
    fetchReservationsOverlapping(branchId, dashboardWindows("bundle", date, now)),
    fetchRooms(branchId),
    fetchBranch(branchId),
  ]);

  const reservations = reservationsRaw as unknown as DashboardReservation[];
  const rooms = (Array.isArray(roomsRaw) ? roomsRaw : []) as DashboardRoom[];

  return {
    date,
    stats: buildDashboardStats(date, reservations, rooms, now),
    timeline: buildDashboardTimeline(date, reservations, rooms, branch),
    trend: buildDashboardTrend(date, reservations),
  };
}
