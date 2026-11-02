import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

const mocks = vi.hoisted(() => ({ rateLimit: vi.fn(), requireAdminApiAuth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, getClientIp: () => "synthetic-ip",
  guestRateLimitId: () => "synthetic-guest", getRateLimitMode: () => "memory" }));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getSessionSecret: () => "synthetic" }));
vi.mock("@/lib/admin-api-auth", () => ({ ADMIN_SESSION_COOKIE: "admin_session",
  requireAdminApiAuth: mocks.requireAdminApiAuth, verifyAdminSession: vi.fn(),
  isAdminOnlyApiPath: () => false, isAdminAuthRequired: () => true }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(),
  isAdminCronGetPath: () => false, isVercelCronRequest: () => false }));
import { middleware } from "./middleware";

const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
const req = (path: string, method = "GET") => new NextRequest(`http://localhost${path}`, { method });
const orderPath = "/api/admin/reservation-orders/synthetic-reservation";
beforeEach(() => { vi.clearAllMocks(); mocks.rateLimit.mockResolvedValue({ success: true }); mocks.requireAdminApiAuth.mockResolvedValue(null); });

describe("private order GET middleware cache policy", () => {
  it("marks allowed order reads non-storable without changing the rate limit header", async () => {
    const response = await middleware(req(orderPath), event);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-ratelimit-mode")).toBe("memory");
  });
  it("also covers a trailing slash and ignores query parameters", async () => {
    const response = await middleware(req(`${orderPath}/?synthetic=1`), event);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("marks authentication errors non-storable without allowing access", async () => {
    mocks.requireAdminApiAuth.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await middleware(req(orderPath), event);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("marks rate-limit errors non-storable without entering the auth handler", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ success: false, reset: Date.now() + 10000 });
    const response = await middleware(req(orderPath), event);
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.requireAdminApiAuth).not.toHaveBeenCalled();
  });
  it.each([["/api/admin/other", "GET"], [`${orderPath}/other`, "GET"], [orderPath, "POST"]])("does not change unrelated %s %s requests", async (path, method) => {
    const response = await middleware(req(path, method), event);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("x-ratelimit-mode")).toBe("memory");
  });
});
