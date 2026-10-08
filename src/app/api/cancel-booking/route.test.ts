import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as guestAuth from "@/lib/guest-auth";

const mocks = vi.hoisted(() => ({ transition: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: vi.fn(() => true) }));
vi.mock("@/lib/guest-rate-limit", () => ({ enforceGuestLookupLimit: vi.fn(async () => null) }));
vi.mock("@/lib/reservation-lifecycle", async (orig) => ({
  ...(await orig<typeof import("@/lib/reservation-lifecycle")>()),
  transitionReservation: mocks.transition,
}));

const req = () =>
  new NextRequest("https://test.local/api/cancel-booking", {
    method: "POST",
    body: JSON.stringify({ id: "res-1", token: "valid-signed-token" }),
  });

describe("POST /api/cancel-booking (auth + HTTP mapping; policy is tested in reservation-lifecycle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(guestAuth, "verifyGuestBookingByTokenOrCredentials").mockResolvedValue({
      ok: true,
      reservation: { id: "res-1" } as unknown as NonNullable<guestAuth.GuestReservation>,
    });
  });

  it("cancels as the guest actor", async () => {
    mocks.transition.mockResolvedValue({ ok: true, status: "cancelled" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.transition).toHaveBeenCalledWith("res-1", { type: "cancel" }, { kind: "guest" });
  });

  it("keeps the blocked-cancel response shape", async () => {
    mocks.transition.mockResolvedValue({
      ok: false, code: "cancel_blocked", message: "請來電", httpStatus: 400,
      eligibility: "staff_review_required", refundRequestAvailable: true,
    });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "請來電", eligibility: "staff_review_required", refund_request_available: true });
  });
});
