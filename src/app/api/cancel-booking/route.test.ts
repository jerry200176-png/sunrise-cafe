import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as guestAuth from "@/lib/guest-auth";
import * as supabaseAdmin from "@/lib/supabase-admin";

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: vi.fn(() => true),
  updateReservationAdmin: vi.fn(async () => {}),
}));

vi.mock("@/lib/waitlist", () => ({
  notifyWaitlist: vi.fn(async () => {}),
}));

vi.mock("@/lib/guest-rate-limit", () => ({
  enforceGuestLookupLimit: vi.fn(async () => null),
}));

vi.mock("@/lib/cancel-refund-policy", () => ({
  evaluateGuestCancel: vi.fn(() => ({ allowed: true })),
}));

describe("POST /api/cancel-booking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates cancellation via signed lookup token", async () => {
    vi.spyOn(guestAuth, "verifyGuestBookingByTokenOrCredentials").mockResolvedValue({
      ok: true,
      reservation: {
        id: "res-token-cancel",
        status: "confirmed",
        room_id: "room-1",
        start_time: "2026-09-12T14:00:00+08:00",
        end_time: "2026-09-12T16:00:00+08:00",
        is_deposit_paid: false,
      } as unknown as NonNullable<guestAuth.GuestReservation>,
    });

    const req = new NextRequest("https://test.local/api/cancel-booking", {
      method: "POST",
      body: JSON.stringify({
        id: "res-token-cancel",
        token: "valid-signed-token",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(supabaseAdmin.updateReservationAdmin).toHaveBeenCalledWith(
      "res-token-cancel",
      expect.objectContaining({ status: "cancelled" })
    );
  });
});
