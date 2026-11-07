/**
 * Signed lookup tokens for guest booking management without URL PII.
 * Prevents exposing phone numbers in URL query strings / logs.
 *
 * Format: base64url(reservationId).exp.base64url(hmac)
 * Domain-separated prefix "lookup:" prevents token confusion with attendance tokens.
 */
import crypto from "crypto";

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export class LookupSigningUnavailableError extends Error {
  constructor() {
    super("Guest lookup signing is not configured (set GUEST_LOOKUP_SECRET or SESSION_SECRET)");
    this.name = "LookupSigningUnavailableError";
  }
}

/**
 * Secret for signing and verifying guest lookup tokens (fail closed in production).
 * 1. Dedicated `GUEST_LOOKUP_SECRET`.
 * 2. `SESSION_SECRET`.
 * 3. Non-production only: a fixed local dev string (tests / local dev).
 * Production without 1 or 2 throws. `ADMIN_PASSWORD` is never used: as an HMAC key
 * it could be brute-forced offline from any guest token.
 *
 * NEVER reuse `SUPABASE_SERVICE_ROLE_KEY` here.
 */
export function getLookupSigningSecret(): string {
  const configured =
    process.env.GUEST_LOOKUP_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new LookupSigningUnavailableError();
  return "sunrise-guest-lookup-dev-secret";
}

/** Boolean-only check for callers that must stop before any DB write or notification. */
export function isLookupSigningConfigured(): boolean {
  try {
    getLookupSigningSecret();
    return true;
  } catch {
    return false;
  }
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
  | { ok: false; error: "invalid_format" | "expired" | "signature_mismatch" | "signing_unavailable" };

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

  if (!isLookupSigningConfigured()) {
    return { ok: false, error: "signing_unavailable" };
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
