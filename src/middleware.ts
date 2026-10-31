import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp, guestRateLimitId, getRateLimitMode } from "@/lib/rate-limit";
import { logOps } from "@/lib/ops-log";
import { getSessionSecret } from "@/lib/admin-auth";
import {
  ADMIN_SESSION_COOKIE,
  requireAdminApiAuth,
  verifyAdminSession,
  isAdminOnlyApiPath,
  isAdminAuthRequired,
} from "@/lib/admin-api-auth";
import {
  authorizeCronGet,
  isAdminCronBearerRoute,
  isAdminCronGetPath,
  isVercelCronRequest,
} from "@/lib/cron-request-auth";

const COOKIE_NAME = ADMIN_SESSION_COOKIE;

async function verifySession(value: string, secret: string): Promise<boolean> {
  return verifyAdminSession(value, secret);
}

function withRateLimitMode(response: NextResponse): NextResponse {
  response.headers.set("X-RateLimit-Mode", getRateLimitMode());
  return response;
}

function tooManyRequests(reset: number, path: string, limiter: string) {
  logOps("guest", "guest.lookup_denied_rate_limit", { path, limiter });
  return withRateLimitMode(
    NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) },
      }
    )
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  // ── Rate Limiting ──────────────────────────────────────────────────
  if (pathname === "/api/admin/login" && request.method === "POST") {
    const { success, reset } = await rateLimit(ip, "login");
    if (!success) return tooManyRequests(reset, pathname, "login");
  } else if (pathname === "/api/reservations" && request.method === "POST") {
    const { success, reset } = await rateLimit(ip, "booking");
    if (!success) return tooManyRequests(reset, pathname, "booking");
  } else if (pathname === "/api/availability") {
    const { success, reset } = await rateLimit(ip, "availability");
    if (!success) return tooManyRequests(reset, pathname, "availability");
  } else if (pathname === "/api/my-bookings" && request.method === "GET") {
    const phone = request.nextUrl.searchParams.get("phone");
    const { success, reset } = await rateLimit(guestRateLimitId(ip, phone), "guestLookup");
    if (!success) return tooManyRequests(reset, pathname, "guestLookup");
  } else if (pathname === "/api/waitlist" && request.method === "GET") {
    const phone = request.nextUrl.searchParams.get("phone");
    const { success, reset } = await rateLimit(guestRateLimitId(ip, phone), "guestLookup");
    if (!success) return tooManyRequests(reset, pathname, "guestLookup");
  } else if (
    (pathname === "/api/my-bookings" && request.method === "POST") ||
    (pathname === "/api/cancel-booking" && request.method === "POST") ||
    (pathname === "/api/reschedule-booking" && request.method === "POST")
  ) {
    const { success, reset } = await rateLimit(guestRateLimitId(ip, null), "guestLookup");
    if (!success) return tooManyRequests(reset, pathname, "guestLookup");
  } else if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/webhooks/") &&
    !(
      request.method === "GET" &&
      isAdminCronGetPath(pathname) &&
      process.env.CRON_SECRET?.trim() &&
      authorizeCronGet(request).ok
    )
  ) {
    // webhooks / Vercel Cron 不套用一般 API 限流，避免排程被 429 擋下
    // 排程僅在 Bearer 驗證成功時豁免；來源 header 可以被偽造。
    const { success, reset } = await rateLimit(ip, "api");
    if (!success) return tooManyRequests(reset, pathname, "api");
  }

  // ── CTO / Ops evidence（Bearer CTO_OUTCOME_SECRET / CRON_SECRET）────────
  if (pathname.startsWith("/api/cto/") || pathname.startsWith("/api/ops/")) {
    const cronSecret = process.env.CRON_SECRET;
    const outcomeSecret = process.env.CTO_OUTCOME_SECRET;
    const authHeader = request.headers.get("authorization");
    const allowed =
      (outcomeSecret && authHeader === `Bearer ${outcomeSecret}`) ||
      (cronSecret && authHeader === `Bearer ${cronSecret}`);
    if (allowed) return withRateLimitMode(NextResponse.next());
    return withRateLimitMode(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  // ── Admin API 驗證（/api/admin/*，排除登入端點）──────────────────────
  // 注意：API 路徑開頭是 /api，不會進入下方 /admin 頁面驗證，需在此單獨防護。
  if (pathname.startsWith("/api/admin") && pathname !== "/api/admin/login") {
    // Cron GET：只接受 Bearer CRON_SECRET；正式環境未設 secret 一律拒絕（fail closed）
    if (request.method === "GET" && isAdminCronGetPath(pathname)) {
      const cronAuth = authorizeCronGet(request);
      if (cronAuth.ok) return withRateLimitMode(NextResponse.next());
      // Cron 呼叫但驗證失敗 → 直接 401（不要再走 admin cookie）
      if (isVercelCronRequest(request) || request.headers.get("authorization")) {
        return withRateLimitMode(cronAuth.response);
      }
    } else if (isAdminCronBearerRoute(request.method, pathname) && process.env.CRON_SECRET?.trim()) {
      const cronAuth = authorizeCronGet(request);
      if (cronAuth.ok && cronAuth.via === "cron_secret") {
        return withRateLimitMode(NextResponse.next());
      }
    }
    const denied = await requireAdminApiAuth(request);
    if (denied) return withRateLimitMode(denied);
    return withRateLimitMode(NextResponse.next());
  }

  // ── Admin-only API（訂位讀取/變更、分店/設定變更等）────────────────
  if (isAdminOnlyApiPath(pathname, request.method)) {
    const denied = await requireAdminApiAuth(request);
    if (denied) return withRateLimitMode(denied);
    return withRateLimitMode(NextResponse.next());
  }

  // ── Admin 頁面 Session 驗證 ─────────────────────────────────────────
  if (pathname === "/admin/login") return withRateLimitMode(NextResponse.next());
  if (!pathname.startsWith("/admin")) return withRateLimitMode(NextResponse.next());

  if (!isAdminAuthRequired()) return withRateLimitMode(NextResponse.next());
  const signingKey = getSessionSecret();
  if (!signingKey) {
    return withRateLimitMode(NextResponse.redirect(new URL("/admin/login", request.url)));
  }

  const cookie = request.cookies.get(COOKIE_NAME);
  if (!cookie?.value) {
    return withRateLimitMode(NextResponse.redirect(new URL("/admin/login", request.url)));
  }

  const ok = await verifySession(cookie.value, signingKey);
  if (!ok) {
    const res = NextResponse.redirect(new URL("/admin/login", request.url));
    res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return withRateLimitMode(res);
  }

  return withRateLimitMode(NextResponse.next());
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/:path*"],
};
