/**
 * Signed lookup tokens for guest booking management without URL PII.
 * Prevents exposing phone numbers in URL query strings / logs.
 *
 * Format: base64url(reservationId).exp.base64url(hmac)
 * Domain-separated prefix "lookup:" prevents token confusion with attendance tokens.
 */
import crypto from "crypto";

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Dedicated secret for signing and verifying guest lookup tokens.
 * Key separation rules:
 * 1. Dedicated `GUEST_LOOKUP_SECRET` if configured.
 * 2. Fallback to `SESSION_SECRET` (application session signing secret).
 * 3. Fallback to `ADMIN_PASSWORD` (legacy bootstrap).
 * 4. In development/testing, fallback to local dev string.
 *
 * CRITICAL SECURITY INVARIANT:
 * NEVER reuse or fallback to `SUPABASE_SERVICE_ROLE_KEY`. Database administrative
 * keys must remain strictly isolated from public guest token HMAC signatures.
 */
export function getLookupSigningSecret(): string {
  const dedicated = process.env.GUEST_LOOKUP_SECRET?.trim();
  if (dedicated) return dedicated;

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret) return sessionSecret;

  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (adminPassword) return adminPassword;

  if (process.env.NODE_ENV === "production") {
    console.warn("[lookup-token] GUEST_LOOKUP_SECRET and SESSION_SECRET unset in production");
  }

  return "sunrise-guest-lookup-dev-secret";
}

function secret(): string {
  return getLookupSigningSecret();
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function computeMac(reservationId: string, exp: number): Buffer {
  return crypto
    .createHmac("sha256", secret())
    .update(`lookup:${reservationId}:${exp}`)
    .digest();
}

/**
 * Sign an opaque URL-safe lookup token for a given reservation ID.
 */
export function signLookupToken(reservationId: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = b64url(reservationId);
  const mac = computeMac(reservationId, exp);
  return `${payload}.${exp}.${b64url(mac)}`;
}

export type VerifyLookupTokenResult =
  | { ok: true; reservationId: string }
  | { ok: false; error: "invalid_format" | "expired" | "signature_mismatch" };

/**
 * Verify a lookup token. Timing-safe verification of HMAC signature and expiration.
 */
export function verifyLookupToken(token: string): VerifyLookupTokenResult {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "invalid_format" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "invalid_format" };
  }

  const [payload, expStr, macStr] = parts;
  if (!payload || !expStr || !macStr) {
    return { ok: false, error: "invalid_format" };
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp)) {
    return { ok: false, error: "invalid_format" };
  }

  if (Date.now() > exp) {
    return { ok: false, error: "expired" };
  }

  let reservationId: string;
  try {
    reservationId = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return { ok: false, error: "invalid_format" };
  }

  if (!reservationId || reservationId.length > 64) {
    return { ok: false, error: "invalid_format" };
  }

  const expected = computeMac(reservationId, exp);
  let got: Buffer;
  try {
    got = Buffer.from(macStr, "base64url");
  } catch {
    return { ok: false, error: "invalid_format" };
  }

  if (got.length !== expected.length) {
    return { ok: false, error: "signature_mismatch" };
  }

  if (!crypto.timingSafeEqual(got, expected)) {
    return { ok: false, error: "signature_mismatch" };
  }

  return { ok: true, reservationId };
}
