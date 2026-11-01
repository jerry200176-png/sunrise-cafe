import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ success: true, reset: Date.now() + 60_000 })),
  getClientIp: () => "test-ip",
  guestRateLimitId: () => "test-guest",
  getRateLimitMode: () => "memory",
}));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));

import { middleware as runMiddleware } from "@/middleware";
import { createSignedAdminSession } from "@/lib/admin-api-auth";
const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
const middleware = (request: NextRequest) => runMiddleware(request, event);

function request(path: string, method: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://example.com${path}`, { method, headers });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ADMIN_PASSWORD", "admin-test-password");
  vi.stubEnv("SESSION_SECRET", "admin-test-session-key");
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("cron secret administrative scope", () => {
  it.each([
    ["PATCH", "/api/admin/reminders/123"],
    ["GET", "/api/admin/diagnose-line"],
    ["POST", "/api/admin/users"],
    ["POST", "/api/admin/reminders/send-line"],
    ["POST", "/api/admin/reminders/verify"],
    ["GET", "/api/admin/reminders/verify/extra"],
    ["GET", "/api/admin/migrations/apply-reminded-7d"],
    ["PATCH", "/api/admin/migrations/apply-ops-events"],
    ["POST", "/api/admin/migrations/apply-market-parity"],
  ])("does not grant admin access to %s %s", async (method, path) => {
    const result = await middleware(request(path, method, { authorization: "Bearer cron-test-secret" }));
    expect(result.status).toBe(401);
    expect(result.headers.get("x-middleware-next")).toBeNull();
  });

  it.each([
    ["GET", "/api/admin/reminders/verify"],
    ["POST", "/api/admin/migrations/apply-reminded-7d"],
    ["POST", "/api/admin/migrations/apply-ops-events"],
  ])("preserves the existing machine caller for %s %s", async (method, path) => {
    const valid = await middleware(request(path, method, { authorization: "Bearer cron-test-secret" }));
    expect(valid.headers.get("x-middleware-next")).toBe("1");
    const invalid = await middleware(request(path, method, { authorization: "Bearer wrong" }));
    expect(invalid.status).toBe(401);
    const absent = await middleware(request(path, method));
    expect(absent.status).toBe(401);
  });

  it("does not treat the local no-secret allowance as a machine credential", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "");
    const result = await middleware(request("/api/admin/reminders/verify", "GET"));
    expect(result.status).toBe(401);
  });

  it("continues to accept a valid admin session on restricted routes", async () => {
    const token = await createSignedAdminSession("admin-test-session-key");
    const result = await middleware(request("/api/admin/reminders/123", "PATCH", {
      cookie: `admin_session=${token}`,
    }));
    expect(result.headers.get("x-middleware-next")).toBe("1");
  });
});
