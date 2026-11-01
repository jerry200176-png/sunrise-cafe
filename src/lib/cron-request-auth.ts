/**
 * Auth for cron GET handlers (Vercel Cron and the GitHub Actions backup).
 *
 * Fail closed:
 * - CRON_SECRET set: require `Authorization: Bearer <CRON_SECRET>`. Vercel Cron
 *   injects this header automatically when the env var exists.
 * - CRON_SECRET unset in a production runtime (NODE_ENV or VERCEL_ENV is
 *   "production"): reject with 500. The `x-vercel-cron-schedule` header is
 *   never trusted for auth, because any client can send it.
 * - CRON_SECRET unset in local dev/test: allow, so crons can be exercised locally.
 *
 * Manual callers use POST (admin session, enforced in middleware).
 */
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_CRON_GET_PATHS = [
  "/api/admin/reminders/send-line",
  "/api/admin/reminders/send-line-7d",
  "/api/admin/reminders/deposit-deadline",
  "/api/admin/reminders/deploy-health",
  "/api/linepay/notifications/retry",
] as const;

export function isAdminCronGetPath(pathname: string): boolean {
  return (ADMIN_CRON_GET_PATHS as readonly string[]).includes(pathname);
}

/** Existing, specifically scoped machine callers outside the scheduled GETs. */
export function isAdminCronBearerRoute(method: string, pathname: string): boolean {
  return (method === "GET" && pathname === "/api/admin/reminders/verify") ||
    (method === "POST" && (
      pathname === "/api/admin/migrations/apply-reminded-7d" ||
      pathname === "/api/admin/migrations/apply-ops-events"
    ));
}

/**
 * True when the request carries Vercel's cron schedule header. Informational
 * only (trigger-source labelling); it is NOT an authentication signal.
 */
export function isVercelCronRequest(request: NextRequest): boolean {
  const schedule = request.headers.get("x-vercel-cron-schedule");
  return Boolean(schedule && schedule.trim());
}

export type CronAuthResult =
  | { ok: true; via: "cron_secret" | "cron_secret_unset_dev" }
  | { ok: false; response: NextResponse };

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

/** Compare all character positions without an early exit; usable in the Edge runtime. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Authorize a cron GET. Does not grant admin session access — callers that
 * fail should fall through to requireAdminApiAuth in middleware.
 */
export function authorizeCronGet(request: NextRequest): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret?.trim()) {
    const authHeader = request.headers.get("authorization") ?? "";
    if (safeEqual(authHeader, `Bearer ${cronSecret}`)) {
      return { ok: true, via: "cron_secret" };
    }
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (isProductionRuntime()) {
    console.error("[cron-auth] CRON_SECRET is not configured; rejecting cron GET");
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron authentication is not configured" },
        { status: 500 }
      ),
    };
  }

  return { ok: true, via: "cron_secret_unset_dev" };
}
