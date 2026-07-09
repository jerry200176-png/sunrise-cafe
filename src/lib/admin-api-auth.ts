/**
 * Admin API session guard — shared by middleware and route handlers.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret } from "@/lib/admin-auth";

export const ADMIN_SESSION_COOKIE = "admin_session";

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifyAdminSession(
  value: string,
  secret: string
): Promise<boolean> {
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

/** @returns 401 response if denied; null if request may proceed */
export async function requireAdminApiAuth(
  request: NextRequest
): Promise<NextResponse | null> {
  if (!process.env.ADMIN_PASSWORD) return null;

  const signingKey = getSessionSecret();
  if (!signingKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE);
  const ok = cookie?.value
    ? await verifyAdminSession(cookie.value, signingKey)
    : false;

  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Build signed session cookie value (tests + login route alignment) */
export async function createSignedAdminSession(
  secret: string,
  maxAgeSec = 86400
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iat: now, exp: now + maxAgeSec });
  const encoded = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  const sig = arrayBufferToBase64Url(sigBuffer);
  return `${encoded}.${sig}`;
}

export function isReservationMutationPath(pathname: string, method: string): boolean {
  return (
    /^\/api\/reservations\/[^/]+$/.test(pathname) &&
    (method === "PATCH" || method === "DELETE")
  );
}
