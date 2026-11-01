import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const { rateLimit } = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => ({ success: false, reset: Date.now() + 60_000 })),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  getClientIp: () => "test-ip",
  guestRateLimitId: () => "test-guest",
  getRateLimitMode: () => "memory",
}));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));

import { middleware as runMiddleware } from "@/middleware";
const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
const middleware = (request: NextRequest) => runMiddleware(request, event);

function request(path: string, headers: Record<string, string>, method = "GET") {
  return new NextRequest(`https://example.com${path}`, { method, headers });
}

describe("cron rate limit exemption", () => {
  beforeEach(() => {
    rateLimit.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("limits a forged schedule header on a cron route", async () => {
    const result = await middleware(request("/api/admin/reminders/send-line", {
      "x-vercel-cron-schedule": "0 12 * * *",
    }));
    expect(result.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("test-ip", "api");
  });

  it("limits a schedule header on another API even with a valid secret", async () => {
    const result = await middleware(request("/api/admin/rooms", {
      "x-vercel-cron-schedule": "0 12 * * *",
      authorization: "Bearer test-secret",
    }));
    expect(result.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("test-ip", "api");
  });

  it("does not exempt a POST to a cron path", async () => {
    const result = await middleware(request("/api/admin/reminders/send-line", {
      "x-vercel-cron-schedule": "0 12 * * *",
      authorization: "Bearer test-secret",
    }, "POST"));
    expect(result.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("test-ip", "api");
  });

  it("exempts an authenticated cron GET even without a schedule header", async () => {
    const result = await middleware(request("/api/admin/reminders/send-line", {
      authorization: "Bearer test-secret",
    }));
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
