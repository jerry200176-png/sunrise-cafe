import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp, guestRateLimitId, getRateLimitMode, type LimiterKey } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-response";
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

async function checkLimit(identifier: string, limiter: LimiterKey, path: string, event: NextFetchEvent) {
  const result = await rateLimit(identifier, limiter);
  const response = rateLimitResponse(result);
  if (!response) return null;
  if (!result.unavailable) {
    logOps(
      "guest",
      "guest.lookup_denied_rate_limit",
      { path, limiter },
      (work) => event.waitUntil(work())
    );
  }
  return withRateLimitMode(response);
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  // ── Rate Limiting ──────────────────────────────────────────────────
  if (pathname === "/api/admin/login" && request.method === "POST") {
    const limited = await checkLimit(ip, "login", pathname, event);
    if (limited) return limited;
  } else if (pathname === "/api/reservations" && request.method === "POST") {
    const limited = await checkLimit(ip, "booking", pathname, event);
    if (limited) return limited;
  } else if (pathname === "/api/availability") {
    const limited = await checkLimit(ip, "availability", pathname, event);
    if (limited) return limited;
  } else if (pathname === "/api/my-bookings" && request.method === "GET") {
    const phone = request.nextUrl.searchParams.get("phone");
    const limited = await checkLimit(guestRateLimitId(ip, phone), "guestLookup", pathname, event);
    if (limited) return limited;
  } else if (pathname === "/api/waitlist" && request.method === "GET") {
    const phone = request.nextUrl.searchParams.get("phone");
    const limited = await checkLimit(guestRateLimitId(ip, phone), "guestLookup", pathname, event);
    if (limited) return limited;
  } else if (
    (pathname === "/api/my-bookings" && request.method === "POST") ||
    (pathname === "/api/cancel-booking" && request.method === "POST") ||
    (pathname === "/api/reschedule-booking" && request.method === "POST")
  ) {
    const limited = await checkLimit(guestRateLimitId(ip, null), "guestLookup", pathname, event);
    if (limited) return limited;
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
    const limited = await checkLimit(ip, "api", pathname, event);
    if (limited) return limited;
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
