/**
 * Every cron GET (route handler + middleware) must fail closed when
 * CRON_SECRET is unset in production, and keep working with the Bearer
 * secret that Vercel Cron and the GitHub Actions backup send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_CRON_GET_PATHS } from "./cron-request-auth";

const runCronJob = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
vi.mock("@/lib/job-runs", () => ({ runCronJob }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: vi.fn(() => ({})) }));
const retryDueLinePayNotifications = vi.fn(async () => ({ retried: 0 }));
vi.mock("@/lib/linepay-notification-outbox", () => ({ retryDueLinePayNotifications }));

type GetHandler = (request: NextRequest) => Promise<Response>;

const ROUTES: Record<(typeof ADMIN_CRON_GET_PATHS)[number], () => Promise<{ GET: GetHandler }>> = {
  "/api/admin/reminders/send-line": () => import("@/app/api/admin/reminders/send-line/route"),
  "/api/admin/reminders/send-line-7d": () => import("@/app/api/admin/reminders/send-line-7d/route"),
  "/api/admin/reminders/deposit-deadline": () =>
    import("@/app/api/admin/reminders/deposit-deadline/route"),
  "/api/admin/reminders/deploy-health": () => import("@/app/api/admin/reminders/deploy-health/route"),
  "/api/linepay/notifications/retry": () => import("@/app/api/linepay/notifications/retry/route"),
};

function cronReq(path: string, headers: Record<string, string>) {
  return new NextRequest(`https://example.com${path}`, { method: "GET", headers });
}

function workRan() {
  return runCronJob.mock.calls.length + retryDueLinePayNotifications.mock.calls.length;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("CRON_SECRET", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  runCronJob.mockClear();
  retryDueLinePayNotifications.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(ADMIN_CRON_GET_PATHS)("cron GET %s", (path) => {
  it("route rejects a forged cron header when CRON_SECRET is unset (500, no work)", async () => {
    const { GET } = await ROUTES[path]();
    const res = await GET(cronReq(path, { "x-vercel-cron-schedule": "0 12 * * *" }));
    expect(res.status).toBe(500);
    expect(workRan()).toBe(0);
  });

  it("route rejects the cron header without the Bearer secret when CRON_SECRET is set (401)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET } = await ROUTES[path]();
    const res = await GET(cronReq(path, { "x-vercel-cron-schedule": "0 12 * * *" }));
    expect(res.status).toBe(401);
    expect(workRan()).toBe(0);
  });

  it("route runs with Bearer CRON_SECRET (Vercel Cron / GitHub backup)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET } = await ROUTES[path]();
    const res = await GET(
      cronReq(path, { authorization: "Bearer s3cret", "x-reminder-trigger": "github" })
    );
    expect(res.status).toBe(200);
    expect(workRan()).toBe(1);
  });

  // /api/linepay/* is not gated by middleware; its route handler (above) is the gate.
  const gatedByMiddleware = path.startsWith("/api/admin/");

  it.runIf(gatedByMiddleware)("middleware does not pass a forged cron header through when CRON_SECRET is unset", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(cronReq(path, { "x-vercel-cron-schedule": "0 12 * * *" }));
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it.runIf(gatedByMiddleware)("middleware passes Bearer CRON_SECRET through", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { middleware } = await import("@/middleware");
    const res = await middleware(cronReq(path, { authorization: "Bearer s3cret" }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
