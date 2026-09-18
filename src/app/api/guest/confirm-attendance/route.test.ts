import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { signAttendanceToken } from "@/lib/attendance-token";
import { verifyLookupToken } from "@/lib/lookup-token";

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/line-notify", () => ({
  sendLineFlex: vi.fn(async () => {}),
  sendLineFlexToGroup: vi.fn(async () => {}),
  buildGuestAttendanceConfirmedGroupFlex: vi.fn(() => ({ type: "bubble" })),
}));

vi.mock("@/lib/line", () => ({
  sendLineFlexMessage: vi.fn(async () => {}),
}));

vi.mock("@/lib/line-cards", () => ({
  buildGuestAttendanceConfirmedFlex: vi.fn((params: { lookupToken?: string }) => ({
    type: "bubble",
    _lookupToken: params.lookupToken ?? null,
  })),
}));

vi.mock("@/lib/line-guest-delivery", () => ({
  deliverLineGuestNotification: vi.fn(async ({ send }: { send: () => Promise<unknown> }) => {
    await send();
  }),
}));

const mockMaybeSingle = vi.fn();
const mockUpdateEq = vi.fn(async () => ({ error: null }));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockFrom = vi.fn((table: string) => {
  if (table === "reservations") {
    return { select: mockSelect, update: mockUpdate };
  }
  return { select: mockSelect, update: mockUpdate };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

const RES_A = "res-attendance-a";
const RES_B = "res-attendance-b";

function reservationRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    booking_code: "ABC123",
    customer_name: "測試",
    phone: "0912345678",
    line_user_id: "Uguest",
    start_time: "2026-09-19T10:00:00+08:00",
    end_time: "2026-09-19T12:00:00+08:00",
    status: "confirmed",
    guest_confirmed_at: null,
    is_deposit_paid: true,
    room: { name: "包廂 A", branch: { name: "大安店", line_group_id: null } },
    ...overrides,
  };
}

describe("/api/guest/confirm-attendance lookup_token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-confirm-attendance-secret";
    mockMaybeSingle.mockReset();
    mockUpdateEq.mockResolvedValue({ error: null });
  });

  it("GET preview includes a verifiable lookup_token for the reservation", async () => {
    mockMaybeSingle.mockResolvedValue({ data: reservationRow(RES_A), error: null });
    const attendanceToken = signAttendanceToken(RES_A);
    const req = new NextRequest(
      `https://test.local/api/guest/confirm-attendance?token=${encodeURIComponent(attendanceToken)}`
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.lookup_token).toBe("string");
    const verified = verifyLookupToken(json.lookup_token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.reservationId).toBe(RES_A);
  });

  it("POST first-confirm success includes a verifiable lookup_token", async () => {
    mockMaybeSingle.mockResolvedValue({ data: reservationRow(RES_A), error: null });
    const attendanceToken = signAttendanceToken(RES_A);
    const req = new NextRequest("https://test.local/api/guest/confirm-attendance", {
      method: "POST",
      body: JSON.stringify({ token: attendanceToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.already).toBe(false);
    const verified = verifyLookupToken(json.lookup_token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.reservationId).toBe(RES_A);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("POST already-confirmed includes a verifiable lookup_token", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: reservationRow(RES_A, { guest_confirmed_at: "2026-09-18T01:00:00.000Z" }),
      error: null,
    });
    const attendanceToken = signAttendanceToken(RES_A);
    const req = new NextRequest("https://test.local/api/guest/confirm-attendance", {
      method: "POST",
      body: JSON.stringify({ token: attendanceToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.already).toBe(true);
    const verified = verifyLookupToken(json.lookup_token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.reservationId).toBe(RES_A);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lookup_token for booking A does not verify as booking B", async () => {
    mockMaybeSingle.mockResolvedValue({ data: reservationRow(RES_A), error: null });
    const attendanceToken = signAttendanceToken(RES_A);
    const req = new NextRequest(
      `https://test.local/api/guest/confirm-attendance?token=${encodeURIComponent(attendanceToken)}`
    );
    const res = await GET(req);
    const json = await res.json();
    const verified = verifyLookupToken(json.lookup_token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.reservationId).toBe(RES_A);
      expect(verified.reservationId).not.toBe(RES_B);
    }
  });
});
