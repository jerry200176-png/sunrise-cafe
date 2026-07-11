/**
 * Admin API session guard — shared by middleware and route handlers.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret } from "@/lib/admin-auth";
import type { AdminSessionPayload } from "@/lib/admin-session";
import { payloadToContext } from "@/lib/admin-session";
import type { AdminContext } from "@/lib/rbac";
import { hasPermission, ownerContext } from "@/lib/rbac";

export const ADMIN_SESSION_COOKIE = "admin_session";

/**
 * Whether admin session is required for protected routes.
 * Dev: fail-open when ADMIN_PASSWORD unset (local convenience).
 * Production: always require ADMIN_PASSWORD — misconfiguration must not open admin APIs.
 */
export function isAdminAuthRequired(): boolean {
  if (process.env.ADMIN_PASSWORD) return true;
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.VERCEL_ENV === "production") return true;
  return false;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8-safe base64url (btoa alone throws on non-Latin1, e.g. Chinese display_name). */
function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function parseAdminSessionPayload(
  value: string,
  secret: string
): Promise<AdminSessionPayload | null> {
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const encoded = value.slice(0, dot);
  const sigFromCookie = value.slice(dot + 1);
  if (!encoded || !sigFromCookie) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  const ourSig = arrayBufferToBase64Url(sigBuffer);
  if (ourSig !== sigFromCookie) return null;

  try {
    const json = base64UrlToUtf8(encoded);
    const payload = JSON.parse(json) as AdminSessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyAdminSession(
  value: string,
  secret: string
): Promise<boolean> {
  return (await parseAdminSessionPayload(value, secret)) !== null;
}

export async function getAdminContext(request: NextRequest): Promise<AdminContext> {
  if (!isAdminAuthRequired()) {
    return ownerContext(true);
  }
  const signingKey = getSessionSecret();
  if (!signingKey) return ownerContext(true);
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE);
  if (!cookie?.value) return ownerContext(true);
  const payload = await parseAdminSessionPayload(cookie.value, signingKey);
  if (!payload) return ownerContext(true);
  return payloadToContext(payload);
}

/** @returns 403 if permission denied; otherwise null. Requires valid admin session first. */
export async function requirePermission(
  request: NextRequest,
  permission: string,
  branchId?: string | null
): Promise<NextResponse | null> {
  const authDenied = await requireAdminApiAuth(request);
  if (authDenied) return authDenied;
  const ctx = await getAdminContext(request);
  if (!hasPermission(ctx, permission, branchId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** @returns 401 response if denied; null if request may proceed */
export async function requireAdminApiAuth(
  request: NextRequest
): Promise<NextResponse | null> {
  if (!isAdminAuthRequired()) return null;

  const signingKey = getSessionSecret();
  if (!signingKey) {
    return NextResponse.json(
      { error: "Admin authentication is not configured" },
      { status: 503 }
    );
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

/** True when request carries a valid admin session cookie (for optional detailed responses). */
export async function hasValidAdminSession(request: NextRequest): Promise<boolean> {
  const signingKey = getSessionSecret();
  if (!signingKey) return false;
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE);
  if (!cookie?.value) return false;
  return verifyAdminSession(cookie.value, signingKey);
}

/** Build signed session cookie value (tests + login route alignment) */
export async function createSignedAdminSession(
  secret: string,
  maxAgeSec = 86400,
  claims?: Partial<AdminSessionPayload>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    iat: now,
    exp: now + maxAgeSec,
    ...claims,
  };
  const payloadStr = JSON.stringify(payload);
  const encoded = utf8ToBase64Url(payloadStr);

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

/** RC2 P2 — admin-only API paths (middleware + handler defense in depth) */
export function isAdminOnlyApiPath(pathname: string, method: string): boolean {
  if (isReservationMutationPath(pathname, method)) return true;
  if (pathname === "/api/reservations" && method === "GET") return true;
  if (pathname === "/api/reservations/send-line" && method === "POST") return true;
  if (pathname === "/api/reservations/recurring/admin" && method === "POST") return true;
  if (/^\/api\/branches\/[^/]+$/.test(pathname) && (method === "PATCH" || method === "DELETE")) {
    return true;
  }
  if (pathname === "/api/settings" && method === "PATCH") return true;
  if (pathname === "/api/branches" && method === "POST") return true;
  if (pathname === "/api/rooms" && method === "POST") return true;
  if (/^\/api\/rooms\/[^/]+$/.test(pathname) && (method === "PATCH" || method === "DELETE")) {
    return true;
  }
  if (pathname === "/api/reservations/recurring" && method === "POST") return true;
  if (pathname === "/api/diagnose" && method === "GET") return true;
  return false;
}
