import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizePhone,
  normalizeBookingCode,
  isValidBookingCodeFormat,
  isValidBookingDateFormat,
  isRecoverableBookingDate,
  verifyGuestBooking,
  verifyGuestBookingById,
  GUEST_BOOKING_NOT_FOUND,
} from "./guest-auth";

vi.mock("@/lib/supabase-admin", () => ({
  fetchReservationByPhoneAndCode: vi.fn(),
}));

import { fetchReservationByPhoneAndCode } from "@/lib/supabase-admin";

const mockFetch = vi.mocked(fetchReservationByPhoneAndCode);

const sampleReservation = {
  id: "res-uuid-1",
  booking_code: "ABC123",
  phone: "0912345678",
  room_id: "room-1",
  start_time: "2026-08-01T10:00:00+08:00",
  end_time: "2026-08-01T12:00:00+08:00",
  status: "pending",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("normalizePhone", () => {
  it("strips formatting", () => {
    expect(normalizePhone("0912-345-678")).toBe("0912345678");
  });

  it("converts +886 to 0 prefix", () => {
    expect(normalizePhone("+886912345678")).toBe("0912345678");
  });
});

describe("normalizeBookingCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeBookingCode(" abc123 ")).toBe("ABC123");
  });
});

describe("isValidBookingCodeFormat", () => {
  it("accepts 6 alphanumeric chars", () => {
    expect(isValidBookingCodeFormat("ABC123")).toBe(true);
  });

  it("rejects short or special chars", () => {
    expect(isValidBookingCodeFormat("AB12")).toBe(false);
    expect(isValidBookingCodeFormat("ABC-12")).toBe(false);
  });
});

describe("isValidBookingDateFormat", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidBookingDateFormat("2026-08-01")).toBe(true);
  });

  it("rejects invalid calendar dates", () => {
    expect(isValidBookingDateFormat("2026-13-01")).toBe(false);
    expect(isValidBookingDateFormat("2026-02-30")).toBe(false);
    expect(isValidBookingDateFormat("08/01/2026")).toBe(false);
  });
});

describe("isRecoverableBookingDate", () => {
  it("accepts Taipei today", () => {
    const taipeiToday = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
    );
    const y = taipeiToday.getFullYear();
    const m = String(taipeiToday.getMonth() + 1).padStart(2, "0");
    const d = String(taipeiToday.getDate()).padStart(2, "0");
    expect(isRecoverableBookingDate(`${y}-${m}-${d}`)).toBe(true);
  });

  it("rejects dates clearly in the past", () => {
    expect(isRecoverableBookingDate("2020-01-01")).toBe(false);
  });

  it("rejects dates beyond 90 days", () => {
    const taipeiToday = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
    );
    const far = new Date(taipeiToday);
    far.setDate(far.getDate() + 120);
    const y = far.getFullYear();
    const m = String(far.getMonth() + 1).padStart(2, "0");
    const d = String(far.getDate()).padStart(2, "0");
    expect(isRecoverableBookingDate(`${y}-${m}-${d}`)).toBe(false);
  });
});

describe("verifyGuestBooking", () => {
  it("returns 400 when phone missing", async () => {
    const r = await verifyGuestBooking("", "ABC123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("returns 400 for invalid booking code format", async () => {
    const r = await verifyGuestBooking("0912345678", "bad");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("returns 404 when phone and code do not match any reservation", async () => {
    mockFetch.mockResolvedValue(null);
    const r = await verifyGuestBooking("0912345678", "ABC123");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.error).toBe(GUEST_BOOKING_NOT_FOUND);
    }
  });

  it("returns reservation when phone and code match", async () => {
    mockFetch.mockResolvedValue(sampleReservation);
    const r = await verifyGuestBooking("0912345678", "abc123");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reservation.id).toBe("res-uuid-1");
    expect(mockFetch).toHaveBeenCalledWith("0912345678", "ABC123");
  });
});

describe("verifyGuestBookingById — IDOR prevention", () => {
  it("returns 404 when id does not match verified reservation", async () => {
    mockFetch.mockResolvedValue(sampleReservation);
    const r = await verifyGuestBookingById("0912345678", "ABC123", "wrong-id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("succeeds when id matches", async () => {
    mockFetch.mockResolvedValue(sampleReservation);
    const r = await verifyGuestBookingById("0912345678", "ABC123", "res-uuid-1");
    expect(r.ok).toBe(true);
  });
});
