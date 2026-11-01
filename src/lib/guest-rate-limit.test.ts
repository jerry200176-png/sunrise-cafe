import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  getClientIp: () => "synthetic",
  guestRateLimitId: () => "synthetic",
}));
import { enforceGuestLookupLimit } from "./guest-rate-limit";

describe("guest lookup rate limit", () => {
  it.each([[true, 503], [false, 429]])("separates dependency failure=%s from quota rejection", async (unavailable, status) => {
    mocks.rateLimit.mockResolvedValue({ success: false, unavailable, reset: Date.now() + 5000 });
    const response = await enforceGuestLookupLimit(new NextRequest("https://test.local"), "synthetic");
    expect(response?.status).toBe(status);
  });
});
