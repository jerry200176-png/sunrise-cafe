/**
 * LINE Login OAuth — signed state + httpOnly bind cookie.
 * See docs/LINE_OAUTH_SECURITY.md
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret } from "@/lib/admin-auth";

export const LINE_BIND_COOKIE = "line_bind_session";
export const LINE_OAUTH_STATE_COOKIE = "line_oauth_state";
const STATE_MAX_AGE_SEC = 600; // 10 min
const BIND_MAX_AGE_SEC = 86400; // 24h

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return arrayBufferToBase64Url(sig);
}

async function hmacVerify(message: string, sig: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(message, secret);
  return expected === sig;
}

export type LineOAuthMode = "prebooking" | "post_booking";

export type LineOAuthStatePayload = {
  mode: LineOAuthMode;
  booking_code?: string;
  nonce: string;
  exp: number;
};

export async function createLineOAuthState(
  payload: Omit<LineOAuthStatePayload, "nonce" | "exp">,
  secret: string
): Promise<string> {
  const full: LineOAuthStatePayload = {
    ...payload,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + STATE_MAX_AGE_SEC,
  };
  const encoded = btoa(JSON.stringify(full))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = await hmacSign(encoded, secret);
  return `${encoded}.${sig}`;
}

export async function verifyLineOAuthState(
  token: string,
  secret: string
): Promise<LineOAuthStatePayload | null> {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!encoded || !sig) return null;
  if (!(await hmacVerify(encoded, sig, secret))) return null;

  try {
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as LineOAuthStatePayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.mode !== "prebooking" && payload.mode !== "post_booking") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createLineBindCookieValue(
  lineUserId: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ uid: lineUserId, exp: now + BIND_MAX_AGE_SEC });
  const encoded = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = await hmacSign(encoded, secret);
  return `${encoded}.${sig}`;
}

export async function verifyLineBindCookie(
  value: string,
  secret: string
): Promise<string | null> {
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const encoded = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!encoded || !sig) return null;
  if (!(await hmacVerify(encoded, sig, secret))) return null;

  try {
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { uid?: string; exp?: number };
    if (!payload.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    // LINE user IDs are U + 32 hex chars
    if (!/^U[0-9a-f]{32}$/i.test(payload.uid)) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

export function getLineUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return Promise.resolve(null);
  const cookie = request.cookies.get(LINE_BIND_COOKIE);
  if (!cookie?.value) return Promise.resolve(null);
  return verifyLineBindCookie(cookie.value, secret);
}

export function setLineBindCookie(response: NextResponse, value: string): void {
  response.cookies.set(LINE_BIND_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BIND_MAX_AGE_SEC,
  });
}

export function clearLineBindCookie(response: NextResponse): void {
  response.cookies.set(LINE_BIND_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
}

export function buildLineAuthorizeUrl(
  origin: string,
  clientId: string,
  signedState: string
): string {
  const redirectUri = `${origin}/api/auth/line/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: signedState,
    scope: "profile",
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}
