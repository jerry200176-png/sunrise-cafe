/**
 * Business KPI calculations — pure functions for admin BI.
 * Revenue/occupancy from reservations; funnel from analytics where noted.
 */

export const BOOKING_ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
  "completed",
] as const;

export type ReservationKpiInput = {
  status: string;
  total_price: number | null;
  start_time: string;
  end_time: string;
  phone?: string | null;
};

export function parseHm(
  value: string | null | undefined,
  fallback: { h: number; m: number }
): { h: number; m: number } {
  if (!value) return fallback;
  const [h, m] = String(value).split(":").map(Number);
  return {
    h: Number.isFinite(h) ? h : fallback.h,
    m: Number.isFinite(m) ? m : fallback.m,
  };
}

/** Booked duration in hours from ISO timestamps */
export function reservationDurationHours(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
}

/** Branch open hours per calendar day (handles overnight close) */
export function branchOpenHoursPerDay(
  openTime: string | null | undefined,
  closeTime: string | null | undefined
): number {
  const open = parseHm(openTime, { h: 9, m: 0 });
  const close = parseHm(closeTime, { h: 21, m: 0 });
  const openMinutes = open.h * 60 + open.m;
  let closeMinutes = close.h * 60 + close.m;
  if (closeMinutes <= openMinutes) closeMinutes += 24 * 60;
  return (closeMinutes - openMinutes) / 60;
}

export function sumBookedHours(reservations: ReservationKpiInput[]): number {
  return reservations
    .filter((r) => BOOKING_ACTIVE_STATUSES.includes(r.status as (typeof BOOKING_ACTIVE_STATUSES)[number]))
    .reduce((sum, r) => sum + reservationDurationHours(r.start_time, r.end_time), 0);
}

export function sumRevenue(reservations: ReservationKpiInput[]): number {
  return reservations
    .filter((r) => BOOKING_ACTIVE_STATUSES.includes(r.status as (typeof BOOKING_ACTIVE_STATUSES)[number]))
    .reduce((sum, r) => sum + (Number(r.total_price) || 0), 0);
}

export function computeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return +(numerator / denominator).toFixed(4);
}

export function computeOccupancyRate(
  bookedHours: number,
  availableRoomHours: number
): number | null {
  return computeRate(bookedHours, availableRoomHours);
}

export function computeRevPerAvailableRoomHour(
  revenue: number,
  availableRoomHours: number
): number | null {
  if (availableRoomHours <= 0) return null;
  return Math.round(revenue / availableRoomHours);
}

export function isProbableNoShow(
  reservation: { status: string; start_time: string },
  nowMs: number,
  graceMinutes = 30
): boolean {
  if (["cancelled", "checked_in", "completed"].includes(reservation.status)) {
    return false;
  }
  if (!["pending", "confirmed"].includes(reservation.status)) return false;
  const startMs = new Date(reservation.start_time).getTime();
  return nowMs > startMs + graceMinutes * 60 * 1000;
}

export function countNoShows(
  reservations: { status: string; start_time: string }[],
  nowMs: number,
  graceMinutes = 30
): number {
  return reservations.filter((r) => isProbableNoShow(r, nowMs, graceMinutes)).length;
}

export function computeNoShowRate(
  noShows: number,
  expectedArrivals: number
): number | null {
  return computeRate(noShows, expectedArrivals);
}

/** Unique phones with booking counts — admin-only aggregation */
export function computeCustomerReturnMetrics(phones: (string | null | undefined)[]): {
  unique_customers: number;
  returning_customers: number;
  loyal_customers: number;
  return_rate: number | null;
} {
  const counts = new Map<string, number>();
  for (const raw of phones) {
    const phone = raw?.trim();
    if (!phone) continue;
    counts.set(phone, (counts.get(phone) ?? 0) + 1);
  }
  const unique = counts.size;
  const returning = [...counts.values()].filter((c) => c >= 2).length;
  const loyal = [...counts.values()].filter((c) => c >= 4).length;
  return {
    unique_customers: unique,
    returning_customers: returning,
    loyal_customers: loyal,
    return_rate: computeRate(returning, unique),
  };
}

export function computeCancellationBreakdown(
  reservations: { status: string }[]
): {
  total: number;
  active: number;
  cancelled: number;
  cancellation_rate: number | null;
} {
  const total = reservations.length;
  const cancelled = reservations.filter((r) => r.status === "cancelled").length;
  const active = total - cancelled;
  return {
    total,
    active,
    cancelled,
    cancellation_rate: computeRate(cancelled, total),
  };
}

export function computeWaitlistRecovery(
  entries: { status: string }[]
): {
  joined: number;
  notified: number;
  booked: number;
  recovery_rate: number | null;
} {
  const joined = entries.length;
  const notified = entries.filter((e) =>
    ["notified", "booked"].includes(e.status)
  ).length;
  const booked = entries.filter((e) => e.status === "booked").length;
  return {
    joined,
    notified,
    booked,
    recovery_rate: computeRate(booked, joined),
  };
}

export type HourBucket = { hour: number; bookings: number; revenue: number };

/** Peak vs off-peak from reservation start times (Taipei hour 0–23) */
export function buildHourBuckets(
  reservations: ReservationKpiInput[],
  taipeiHour: (iso: string) => number
): HourBucket[] {
  const map = new Map<number, { bookings: number; revenue: number }>();
  for (const r of reservations) {
    if (!BOOKING_ACTIVE_STATUSES.includes(r.status as (typeof BOOKING_ACTIVE_STATUSES)[number])) {
      continue;
    }
    const h = taipeiHour(r.start_time);
    const cur = map.get(h) ?? { bookings: 0, revenue: 0 };
    cur.bookings += 1;
    cur.revenue += Number(r.total_price) || 0;
    map.set(h, cur);
  }
  return [...map.entries()]
    .map(([hour, v]) => ({ hour, bookings: v.bookings, revenue: Math.round(v.revenue) }))
    .sort((a, b) => a.hour - b.hour);
}

export function splitPeakOffPeak(
  buckets: HourBucket[],
  peakStartHour: number,
  peakEndHour: number
): {
  peak: { bookings: number; revenue: number };
  off_peak: { bookings: number; revenue: number };
} {
  const peak = { bookings: 0, revenue: 0 };
  const off_peak = { bookings: 0, revenue: 0 };
  for (const b of buckets) {
    const inPeak = b.hour >= peakStartHour && b.hour < peakEndHour;
    if (inPeak) {
      peak.bookings += b.bookings;
      peak.revenue += b.revenue;
    } else {
      off_peak.bookings += b.bookings;
      off_peak.revenue += b.revenue;
    }
  }
  return { peak, off_peak };
}

export function computeFunnelConversion(funnel: {
  booking_started: number;
  room_selected: number;
  slot_selected: number;
  booking_completed: number;
}): {
  overall_conversion: number | null;
  room_step_rate: number | null;
  slot_step_rate: number | null;
  complete_step_rate: number | null;
} {
  const { booking_started, room_selected, slot_selected, booking_completed } = funnel;
  return {
    overall_conversion: computeRate(booking_completed, booking_started),
    room_step_rate: computeRate(room_selected, booking_started),
    slot_step_rate: computeRate(slot_selected, room_selected),
    complete_step_rate: computeRate(booking_completed, slot_selected),
  };
}

export function computeRoomUtilization(
  reservations: (ReservationKpiInput & { room_id: string })[],
  roomMeta: { id: string; name: string; branch_id: string }[],
  availableHoursPerRoom: number
): {
  room_id: string;
  room_name: string;
  branch_id: string;
  booked_hours: number;
  utilization_rate: number | null;
  revenue: number;
}[] {
  return roomMeta.map((room) => {
    const roomRes = reservations.filter(
      (r) =>
        r.room_id === room.id &&
        BOOKING_ACTIVE_STATUSES.includes(r.status as (typeof BOOKING_ACTIVE_STATUSES)[number])
    );
    const booked_hours = sumBookedHours(roomRes);
    const revenue = sumRevenue(roomRes);
    return {
      room_id: room.id,
      room_name: room.name,
      branch_id: room.branch_id,
      booked_hours: +booked_hours.toFixed(2),
      utilization_rate: computeOccupancyRate(booked_hours, availableHoursPerRoom),
      revenue: Math.round(revenue),
    };
  });
}
