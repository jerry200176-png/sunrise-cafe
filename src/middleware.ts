import { NextRequest, NextResponse } from "next/server";

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
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded)
  );
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

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/admin/login") {
    return NextResponse.next();
  }
  if (!path.startsWith("/admin")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME);
  const value = cookie?.value;
  if (!value) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const ok = await verifySession(value, secret);
  if (!ok) {
    const res = NextResponse.redirect(new URL("/admin/login", request.url));
    res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
