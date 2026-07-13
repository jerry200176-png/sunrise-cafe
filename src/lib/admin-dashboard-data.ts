/**
 * Shared admin dashboard data — single fetch, multiple views (ADM-005b).
 */
import {
  fetchBranch,
  fetchReservationsAdmin,
  fetchRooms,
} from "@/lib/supabase-admin";

export type DashboardReservation = {
  room_id: string;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  customer_name: string;
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
    start_time: string;
    end_time: string;
    customer_name: string;
    status: string;
    total_price: number | null;
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
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  };
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
    (r) => r.status !== "cancelled" && r.start_time >= dayStart && r.start_time <= dayEnd
  );
  const inUseNow = reservations.filter(
    (r) =>
      r.status !== "cancelled" &&
      r.status !== "completed" &&
      r.start_time <= nowIso &&
      r.end_time > nowIso
  );

  return {
    date,
    todayCount: todayList.length,
    todayRevenue: Math.round(
      todayList.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0)
    ),
    roomsInUseCount: new Set(inUseNow.map((r) => r.room_id)).size,
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
        start_time: r.start_time,
        end_time: r.end_time,
        customer_name: r.customer_name,
        status: r.status,
        total_price: r.total_price,
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
  days = 7
): { endDate: string; points: DashboardTrendPoint[] } {
  const dayList = lastNDays(endDate, days);

  const points = dayList.map((date) => {
    const { start, end } = dayRange(date);
    const filtered = reservations.filter(
      (r) => r.status !== "cancelled" && r.start_time >= start && r.start_time <= end
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
  date: string
): Promise<DashboardBundle> {
  const [reservationsRaw, roomsRaw, branch] = await Promise.all([
    fetchReservationsAdmin(branchId),
    fetchRooms(branchId),
    fetchBranch(branchId),
  ]);

  const reservations = (Array.isArray(reservationsRaw) ? reservationsRaw : []) as DashboardReservation[];
  const rooms = (Array.isArray(roomsRaw) ? roomsRaw : []) as DashboardRoom[];

  return {
    date,
    stats: buildDashboardStats(date, reservations, rooms),
    timeline: buildDashboardTimeline(date, reservations, rooms, branch),
    trend: buildDashboardTrend(date, reservations),
  };
}
