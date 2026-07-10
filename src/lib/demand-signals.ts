/**
 * Demand signal aggregation for future revenue optimization (no dynamic pricing).
 */
import { toTaipei } from "@/lib/datetime";
import {
  branchOpenHoursPerDay,
  reservationDurationHours,
  sumBookedHours,
  sumRevenue,
  BOOKING_ACTIVE_STATUSES,
} from "@/lib/business-kpis";

export type SnapshotInput = {
  snapshot_date: string;
  branch_id: string;
  room_id: string | null;
  hour: number;
  bookings: number;
  booked_hours: number;
  revenue: number;
  cancellations: number;
  waitlist_joins: number;
  avg_lead_time_hours: number | null;
  occupancy_rate: number | null;
};

type ReservationRow = {
  room_id: string;
  branch_id: string;
  status: string;
  total_price: number | null;
  start_time: string;
  end_time: string;
  created_at: string;
  cancelled_at?: string | null;
};

export function bookingLeadTimeHours(created_at: string, start_time: string): number {
  const ms = new Date(start_time).getTime() - new Date(created_at).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

export function buildDemandSnapshots(params: {
  date: string;
  branches: { id: string; open_time: string | null; close_time: string | null }[];
  rooms: { id: string; branch_id: string }[];
  reservations: ReservationRow[];
  waitlistJoins: { room_id: string; created_at: string }[];
  cancellations: { room_id: string; cancelled_at: string | null }[];
}): SnapshotInput[] {
  const { date, branches, rooms, reservations, waitlistJoins, cancellations } = params;
  const branchHours = new Map(
    branches.map((b) => [b.id, branchOpenHoursPerDay(b.open_time, b.close_time)])
  );
  const roomBranch = new Map(rooms.map((r) => [r.id, r.branch_id]));
  const snapshots: SnapshotInput[] = [];

  for (const branch of branches) {
    const branchRooms = rooms.filter((r) => r.branch_id === branch.id);
    const branchRes = reservations.filter((r) => r.branch_id === branch.id);
    const active = branchRes.filter((r) =>
      BOOKING_ACTIVE_STATUSES.includes(r.status as (typeof BOOKING_ACTIVE_STATUSES)[number])
    );
    const booked = sumBookedHours(active);
    const revenue = sumRevenue(active);
    const available = branchRooms.length * (branchHours.get(branch.id) ?? 12);
    const leadTimes = active.map((r) => bookingLeadTimeHours(r.created_at, r.start_time));
    const avgLead =
      leadTimes.length > 0
        ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
        : null;

    const branchCancels = cancellations.filter(
      (c) => roomBranch.get(c.room_id) === branch.id
    ).length;
    const branchWaitlist = waitlistJoins.filter(
      (w) => roomBranch.get(w.room_id) === branch.id
    ).length;

    snapshots.push({
      snapshot_date: date,
      branch_id: branch.id,
      room_id: null,
      hour: -1,
      bookings: active.length,
      booked_hours: +booked.toFixed(2),
      revenue: Math.round(revenue),
      cancellations: branchCancels,
      waitlist_joins: branchWaitlist,
      avg_lead_time_hours: avgLead != null ? +avgLead.toFixed(2) : null,
      occupancy_rate: available > 0 ? +(booked / available).toFixed(4) : null,
    });

    for (const room of branchRooms) {
      const roomRes = active.filter((r) => r.room_id === room.id);
      const roomBooked = sumBookedHours(roomRes);
      const roomRev = sumRevenue(roomRes);
      const roomAvailable = branchHours.get(branch.id) ?? 12;
      snapshots.push({
        snapshot_date: date,
        branch_id: branch.id,
        room_id: room.id,
        hour: -1,
        bookings: roomRes.length,
        booked_hours: +roomBooked.toFixed(2),
        revenue: Math.round(roomRev),
        cancellations: cancellations.filter((c) => c.room_id === room.id).length,
        waitlist_joins: waitlistJoins.filter((w) => w.room_id === room.id).length,
        avg_lead_time_hours: null,
        occupancy_rate:
          roomAvailable > 0 ? +(roomBooked / roomAvailable).toFixed(4) : null,
      });
    }

    const hourMap = new Map<number, { bookings: number; revenue: number; hours: number }>();
    for (const r of active) {
      const h = toTaipei(r.start_time).getHours();
      const cur = hourMap.get(h) ?? { bookings: 0, revenue: 0, hours: 0 };
      cur.bookings += 1;
      cur.revenue += Number(r.total_price) || 0;
      cur.hours += reservationDurationHours(r.start_time, r.end_time);
      hourMap.set(h, cur);
    }
    for (const [hour, v] of hourMap) {
      snapshots.push({
        snapshot_date: date,
        branch_id: branch.id,
        room_id: null,
        hour,
        bookings: v.bookings,
        booked_hours: +v.hours.toFixed(2),
        revenue: Math.round(v.revenue),
        cancellations: 0,
        waitlist_joins: 0,
        avg_lead_time_hours: null,
        occupancy_rate: null,
      });
    }
  }

  return snapshots;
}
