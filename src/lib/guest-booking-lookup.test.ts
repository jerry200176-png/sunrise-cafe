import { describe, it, expect, vi, beforeEach } from "vitest";
import { lookupGuestBookingsByDate, lookupGuestBookingByToken } from "./guest-booking-lookup";
import { signLookupToken } from "./lookup-token";

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: vi.fn(() => true),
  fetchActiveReservationsByPhoneAndDate: vi.fn(),
  fetchRoom: vi.fn(),
  fetchBranch: vi.fn(),
  fetchReservationByPhoneAndCode: vi.fn(),
}));

import {
  fetchActiveReservationsByPhoneAndDate,
  fetchRoom,
  fetchBranch,
} from "@/lib/supabase-admin";

const mockFetchByDate = vi.mocked(fetchActiveReservationsByPhoneAndDate);
const mockFetchRoom = vi.mocked(fetchRoom);
const mockFetchBranch = vi.mocked(fetchBranch);

function taipeiDateOffset(days: number): string {
  const taipeiToday = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
  taipeiToday.setDate(taipeiToday.getDate() + days);
  const y = taipeiToday.getFullYear();
  const m = String(taipeiToday.getMonth() + 1).padStart(2, "0");
  const d = String(taipeiToday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

beforeEach(() => {
  mockFetchByDate.mockReset();
  mockFetchRoom.mockReset();
  mockFetchBranch.mockReset();
});

describe("lookupGuestBookingsByDate", () => {
  it("returns 400 when phone missing", async () => {
    const r = await lookupGuestBookingsByDate("", taipeiDateOffset(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("returns 400 for past dates", async () => {
    const r = await lookupGuestBookingsByDate("0912345678", "2020-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("returns 404 when no matching bookings", async () => {
    mockFetchByDate.mockResolvedValue([]);
    const r = await lookupGuestBookingsByDate("0912345678", taipeiDateOffset(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("returns items including booking_code for recovery", async () => {
    const date = taipeiDateOffset(3);
    mockFetchByDate.mockResolvedValue([
      {
        id: "res-1",
        booking_code: "ABC123",
        room_id: "room-1",
        start_time: `${date}T10:00:00+08:00`,
        end_time: `${date}T12:00:00+08:00`,
        status: "confirmed",
        total_price: 2000,
        guest_count: 4,
        customer_name: "測試",
        is_deposit_paid: false,
        created_at: `${date}T01:00:00+08:00`,
        phone: "0912345678",
      },
    ] as never);
    mockFetchRoom.mockResolvedValue({
      id: "room-1",
      name: "包廂 A",
      branch_id: "branch-1",
    } as never);
    mockFetchBranch.mockResolvedValue({
      id: "branch-1",
      name: "大安店",
      display_name: null,
      payment_info: null,
      line_pay_url: null,
    } as never);

    const r = await lookupGuestBookingsByDate("0912-345-678", date);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].booking_code).toBe("ABC123");
      expect(r.items[0].room_name).toBe("包廂 A");
    }
    expect(mockFetchByDate).toHaveBeenCalledWith("0912345678", date);
  });
});

describe("lookupGuestBookingByToken", () => {
  it("returns 400 when token missing", async () => {
    const r = await lookupGuestBookingByToken("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("returns 400 for invalid or malformed token", async () => {
    const r = await lookupGuestBookingByToken("invalid.token.here");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("returns 400 for expired token", async () => {
    const expiredToken = signLookupToken("res-1", -1000);
    const r = await lookupGuestBookingByToken(expiredToken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
