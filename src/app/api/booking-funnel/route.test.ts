import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  getClientIp: () => "synthetic",
  guestRateLimitId: () => "synthetic",
}));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
import { POST } from "./route";

describe("booking funnel limiter", () => {
  it.each([[true, 503], [false, 429]])("returns %s dependency failure as HTTP %s", async (unavailable, status) => {
    mocks.rateLimit.mockResolvedValue({ success: false, unavailable, reset: Date.now() + 5000 });
    const request = new NextRequest("https://test.local/api/booking-funnel", { method: "POST", body: JSON.stringify({ event: "booking_flow_entered" }) });
    expect((await POST(request)).status).toBe(status);
  });
});
