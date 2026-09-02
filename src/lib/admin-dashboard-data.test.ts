import { describe, expect, it } from "vitest";
import {
  buildDashboardStats,
  buildDashboardTimeline,
  buildDashboardTrend,
  type DashboardReservation,
  type DashboardRoom,
} from "./admin-dashboard-data";

const reservations: DashboardReservation[] = [
  {
    room_id: "r1",
    start_time: "2026-07-10T02:00:00.000Z",
    end_time: "2026-07-10T06:00:00.000Z",
    status: "confirmed",
    total_price: 800,
    customer_name: "Alice",
  },
  {
    room_id: "r2",
    start_time: "2026-07-10T04:00:00.000Z",
    end_time: "2026-07-10T08:00:00.000Z",
    status: "cancelled",
    total_price: 500,
    customer_name: "Bob",
  },
  {
    room_id: "r1",
    start_time: "2026-07-09T02:00:00.000Z",
    end_time: "2026-07-09T06:00:00.000Z",
    status: "confirmed",
    total_price: 600,
    customer_name: "Carol",
  },
];

const rooms: DashboardRoom[] = [
  { id: "r1", name: "A1" },
  { id: "r2", name: "A2" },
];

describe("admin-dashboard-data", () => {
  it("buildDashboardStats excludes cancelled and sums revenue", () => {
    const stats = buildDashboardStats(
      "2026-07-10",
      reservations,
      rooms,
      new Date("2026-07-10T03:00:00.000Z")
    );
    expect(stats.todayCount).toBe(1);
    expect(stats.todayRevenue).toBe(800);
    expect(stats.totalRooms).toBe(2);
    expect(stats.roomsInUseCount).toBe(1);
    expect(stats.roomsBookedCount).toBe(1);
  });

  it("uses Taipei calendar boundaries for stats and trend", () => {
    const boundaryReservations: DashboardReservation[] = [
      { ...reservations[0], start_time: "2026-07-09T16:00:00.000Z", end_time: "2026-07-09T18:00:00.000Z" },
      { ...reservations[0], room_id: "r2", start_time: "2026-07-10T15:59:59.000Z", end_time: "2026-07-10T16:30:00.000Z" },
      { ...reservations[0], room_id: "r2", start_time: "2026-07-10T16:00:00.000Z", end_time: "2026-07-10T18:00:00.000Z" },
    ];
    const stats = buildDashboardStats("2026-07-10", boundaryReservations, rooms, new Date("2026-07-10T05:00:00.000Z"));
    expect(stats.todayCount).toBe(2);
    expect(stats.roomsBookedCount).toBe(2);
    expect(buildDashboardTrend("2026-07-10", boundaryReservations).points[6]?.count).toBe(2);
  });

  it("buildDashboardTimeline groups by room", () => {
    const timeline = buildDashboardTimeline("2026-07-10", reservations, rooms, {
      name: "Test",
      open_time: "09:00",
      close_time: "21:00",
    });
    expect(timeline.branchName).toBe("Test");
    expect(timeline.rooms).toHaveLength(2);
    expect(timeline.rooms[0]?.reservations).toHaveLength(1);
  });

  it("buildDashboardTrend returns 7 points ending on endDate", () => {
    const { endDate, points } = buildDashboardTrend("2026-07-10", reservations);
    expect(endDate).toBe("2026-07-10");
    expect(points).toHaveLength(7);
    expect(points[6]?.date).toBe("2026-07-10");
    expect(points[6]?.count).toBe(1);
    expect(points[5]?.date).toBe("2026-07-09");
    expect(points[5]?.count).toBe(1);
  });
});
