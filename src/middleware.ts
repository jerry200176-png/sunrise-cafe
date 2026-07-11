import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getSessionSecret } from "@/lib/admin-auth";
import {
  ADMIN_SESSION_COOKIE,
  requireAdminApiAuth,
  verifyAdminSession,
  isAdminOnlyApiPath,
  isAdminAuthRequired,
} from "@/lib/admin-api-auth";

const COOKIE_NAME = ADMIN_SESSION_COOKIE;

async function verifySession(value: string, secret: string): Promise<boolean> {
  return verifyAdminSession(value, secret);
}

function tooManyRequests(reset: number) {
  return NextResponse.json(
    { error: "Too Many Requests" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) },
    }
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  // ── Rate Limiting ──────────────────────────────────────────────────
  if (pathname === "/api/admin/login" && request.method === "POST") {
    const { success, reset } = await rateLimit(ip, "login");
    if (!success) return tooManyRequests(reset);
  } else if (pathname === "/api/reservations" && request.method === "POST") {
    const { success, reset } = await rateLimit(ip, "booking");
    if (!success) return tooManyRequests(reset);
  } else if (pathname === "/api/availability") {
    const { success, reset } = await rateLimit(ip, "availability");
    if (!success) return tooManyRequests(reset);
  } else if (
    (pathname === "/api/my-bookings" && request.method === "GET") ||
    (pathname === "/api/cancel-booking" && request.method === "POST") ||
    (pathname === "/api/reschedule-booking" && request.method === "POST")
  ) {
    const { success, reset } = await rateLimit(ip, "guestLookup");
    if (!success) return tooManyRequests(reset);
  } else if (pathname.startsWith("/api/") && !pathname.startsWith("/api/webhooks/")) {
    // webhooks 已有 LINE 簽章驗證，不需額外限流
    const { success, reset } = await rateLimit(ip, "api");
    if (!success) return tooManyRequests(reset);
  }

  // ── CTO Outcome Pipeline（Bearer CTO_OUTCOME_SECRET / CRON_SECRET）────────
  if (pathname.startsWith("/api/cto/")) {
    const cronSecret = process.env.CRON_SECRET;
    const outcomeSecret = process.env.CTO_OUTCOME_SECRET;
    const authHeader = request.headers.get("authorization");
    const allowed =
      (outcomeSecret && authHeader === `Bearer ${outcomeSecret}`) ||
      (cronSecret && authHeader === `Bearer ${cronSecret}`);
    if (allowed) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Admin API 驗證（/api/admin/*，排除登入端點）──────────────────────
  // 注意：API 路徑開頭是 /api，不會進入下方 /admin 頁面驗證，需在此單獨防護。
  if (pathname.startsWith("/api/admin") && pathname !== "/api/admin/login") {
    // Vercel Cron 以 Bearer CRON_SECRET 呼叫，放行（對應路由內另有驗證）
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      return NextResponse.next();
    }
    const denied = await requireAdminApiAuth(request);
    if (denied) return denied;
    return NextResponse.next();
  }

  // ── Admin-only API（訂位讀取/變更、分店/設定變更等）────────────────
  if (isAdminOnlyApiPath(pathname, request.method)) {
    const denied = await requireAdminApiAuth(request);
    if (denied) return denied;
    return NextResponse.next();
  }

  // ── Admin 頁面 Session 驗證 ─────────────────────────────────────────
  if (pathname === "/admin/login") return NextResponse.next();
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  if (!isAdminAuthRequired()) return NextResponse.next();
  const signingKey = getSessionSecret();
  if (!signingKey) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const cookie = request.cookies.get(COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const ok = await verifySession(cookie.value, signingKey);
  if (!ok) {
    const res = NextResponse.redirect(new URL("/admin/login", request.url));
    res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/:path*"],
};
