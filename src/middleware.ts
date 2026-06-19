import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const COOKIE_NAME = "admin_session";

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifySession(value: string, secret: string): Promise<boolean> {
  const dot = value.indexOf(".");
  if (dot === -1) return false;
  const encoded = value.slice(0, dot);
  const sigFromCookie = value.slice(dot + 1);
  if (!encoded || !sigFromCookie) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  const ourSig = arrayBufferToBase64Url(sigBuffer);
  if (ourSig !== sigFromCookie) return false;

  try {
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    const now = Math.floor(Date.now() / 1000);
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
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
  } else if (pathname.startsWith("/api/") && !pathname.startsWith("/api/webhooks/")) {
    // webhooks 已有 LINE 簽章驗證，不需額外限流
    const { success, reset } = await rateLimit(ip, "api");
    if (!success) return tooManyRequests(reset);
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
    // 其餘一律需有效 admin session（未設定密碼時維持與頁面一致的不擋行為）
    const secret = process.env.ADMIN_PASSWORD;
    if (secret) {
      const cookie = request.cookies.get(COOKIE_NAME);
      const ok = cookie?.value ? await verifySession(cookie.value, secret) : false;
      if (!ok) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    return NextResponse.next();
  }

  // ── Admin 頁面 Session 驗證 ─────────────────────────────────────────
  if (pathname === "/admin/login") return NextResponse.next();
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const ok = await verifySession(cookie.value, secret);
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
