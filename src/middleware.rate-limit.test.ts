import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), logOps: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  getClientIp: () => "synthetic",
  guestRateLimitId: () => "synthetic",
  getRateLimitMode: () => "upstash",
}));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));

import { middleware } from "./middleware";

const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
const base = { limit: 5, remaining: 0, reset: Date.now() + 5000, mode: "upstash" };
describe("middleware limiter failures", () => {
  beforeEach(() => { mocks.rateLimit.mockReset(); mocks.logOps.mockReset(); });
  it.each(["/api/admin/login", "/api/reservations", "/api/availability", "/api/my-bookings", "/api/waitlist", "/api/other"])
    ("fails closed with 503 for %s without logging a quota denial", async (path) => {
      mocks.rateLimit.mockResolvedValue({ ...base, success: false, unavailable: true });
      const method = path === "/api/admin/login" || path === "/api/reservations" ? "POST" : "GET";
      const response = await middleware(new NextRequest(`https://example.invalid${path}`, { method }), event);
      expect(response.status).toBe(503);
      expect(response.headers.get("X-RateLimit-Mode")).toBe("upstash");
      expect(mocks.logOps).not.toHaveBeenCalled();
    });
  it("keeps 429 and the quota-denied event for actual rejection", async () => {
    mocks.rateLimit.mockResolvedValue({ ...base, success: false });
    const response = await middleware(new NextRequest("https://example.invalid/api/admin/login", { method: "POST" }), event);
    expect(response.status).toBe(429);
    expect(mocks.logOps).toHaveBeenCalledWith("guest", "guest.lookup_denied_rate_limit", expect.anything(), expect.any(Function));
  });
  it("passes a request that the limiter allowed", async () => {
    mocks.rateLimit.mockResolvedValue({ ...base, success: true });
    const response = await middleware(new NextRequest("https://example.invalid/api/availability"), event);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("preserves the existing webhook exclusion", async () => {
    const response = await middleware(new NextRequest("https://example.invalid/api/webhooks/stripe", { method: "POST" }), event);
    expect(response.status).toBe(200);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });
});
