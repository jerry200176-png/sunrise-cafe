/**
 * Auth for Vercel Cron GET handlers under /api/admin/reminders/*.
 *
 * - If CRON_SECRET is set: require Authorization Bearer (Vercel injects this).
 * - If CRON_SECRET is unset: allow requests that carry Vercel's
 *   `x-vercel-cron-schedule` header so production cron is not silently 401'd
 *   when the env var was never configured. Manual callers still need admin session.
 */
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_CRON_GET_PATHS = [
  "/api/admin/reminders/send-line",
  "/api/admin/reminders/send-line-7d",
  "/api/admin/reminders/deposit-deadline",
  "/api/admin/reminders/deploy-health",
] as const;

export function isAdminCronGetPath(pathname: string): boolean {
  return (ADMIN_CRON_GET_PATHS as readonly string[]).includes(pathname);
}

/** True when Vercel Cron invoked this request (schedule header is always set). */
export function isVercelCronRequest(request: NextRequest): boolean {
  const schedule = request.headers.get("x-vercel-cron-schedule");
  return Boolean(schedule && schedule.trim());
}

export type CronAuthResult =
  | { ok: true; via: "cron_secret" | "vercel_cron_header" | "cron_secret_unset_dev" }
  | { ok: false; response: NextResponse };

/**
 * Authorize a cron GET. Does not grant admin session access — callers that
 * fail should fall through to requireAdminApiAuth in middleware.
 */
export function authorizeCronGet(request: NextRequest): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret) {
    if (authHeader === `Bearer ${cronSecret}`) {
      return { ok: true, via: "cron_secret" };
    }
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // No CRON_SECRET: trust Vercel Cron schedule header only (not forgeable as
  // strongly as a secret, but better than hard-blocking all production crons).
  if (isVercelCronRequest(request)) {
    return { ok: true, via: "vercel_cron_header" };
  }

  // Local/dev without secret: allow (route handlers historically skipped auth).
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production") {
    return { ok: true, via: "cron_secret_unset_dev" };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
