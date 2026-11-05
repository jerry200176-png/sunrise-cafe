import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true })), getClientIp: () => "synthetic", guestRateLimitId: () => "synthetic", getRateLimitMode: () => "memory" }));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(), isAdminCronGetPath: () => false, isVercelCronRequest: () => false }));
vi.mock("@/lib/admin-api-auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin-api-auth")>()), requireAdminApiAuth: mocks.auth }));
import { middleware } from "./middleware";
const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
describe("v2 message copy middleware", () => {
  it.each(["/api/reservations/synthetic/message-actions/v2", "/api/reservations/message-actions/batch/v2"])("rejects unauthenticated POST %s", async (path) => {
    mocks.auth.mockReset().mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await middleware(new NextRequest(`http://localhost${path}`, { method: "POST" }), event);
    expect(response.status).toBe(401);
    expect(mocks.auth).toHaveBeenCalledOnce();
  });
});
