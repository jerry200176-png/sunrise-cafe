import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "./route";
import * as guestLookup from "@/lib/guest-booking-lookup";

vi.mock("@/lib/guest-rate-limit", () => ({
  enforceGuestLookupLimit: vi.fn(async () => null),
}));

describe("/api/my-bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports token lookup in POST body with zero PII", async () => {
    const mockItem = {
      id: "res-1",
      booking_code: "XYZ123",
      room_name: "包廂 A",
      lookup_token: "signed-token-123",
    };
    vi.spyOn(guestLookup, "lookupGuestBookingByToken").mockResolvedValue({
      ok: true,
      items: [mockItem as unknown as guestLookup.GuestBookingItem],
    });

    const req = new NextRequest("https://test.local/api/my-bookings", {
      method: "POST",
      body: JSON.stringify({ token: "signed-token-123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].booking_code).toBe("XYZ123");
    expect(guestLookup.lookupGuestBookingByToken).toHaveBeenCalledWith("signed-token-123");
  });

  it("supports token lookup in GET query for backward compatibility", async () => {
    const mockItem = {
      id: "res-2",
      booking_code: "ABC789",
      lookup_token: "signed-token-456",
    };
    vi.spyOn(guestLookup, "lookupGuestBookingByToken").mockResolvedValue({
      ok: true,
      items: [mockItem as unknown as guestLookup.GuestBookingItem],
    });

    const req = new NextRequest("https://test.local/api/my-bookings?token=signed-token-456");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].booking_code).toBe("ABC789");
    expect(guestLookup.lookupGuestBookingByToken).toHaveBeenCalledWith("signed-token-456");
  });

  it("returns 400 when invalid token is provided", async () => {
    vi.spyOn(guestLookup, "lookupGuestBookingByToken").mockResolvedValue({
      ok: false,
      error: "查詢連結無效，請確認連結完整性",
      status: 400,
    });

    const req = new NextRequest("https://test.local/api/my-bookings", {
      method: "POST",
      body: JSON.stringify({ token: "bad-token" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("無效");
  });

  it("returns 410 Sunset when GET query contains phone parameter", async () => {
    const req = new NextRequest("https://test.local/api/my-bookings?phone=0912345678&booking_code=ABC123");
    const res = await GET(req);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.sunset).toBe(true);
    expect(json.code).toBe("PHONE_URL_PARAM_RETIRED");
  });
});
