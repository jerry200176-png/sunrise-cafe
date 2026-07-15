/**
 * Signed attendance-confirm tokens for D-1 LINE Flex CTAs.
 * Format: base64url(reservationId).base64url(hmac)
 */
import crypto from "crypto";

function secret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.CRON_SECRET ||
    "sunrise-attendance-dev"
  );
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

export function signAttendanceToken(reservationId: string): string {
  const payload = b64url(reservationId);
  const mac = crypto.createHmac("sha256", secret()).update(reservationId).digest();
  return `${payload}.${b64url(mac)}`;
}

export function verifyAttendanceToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  if (!payload || !mac) return null;
  let reservationId: string;
  try {
    reservationId = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!reservationId || reservationId.length > 64) return null;
  const expected = crypto.createHmac("sha256", secret()).update(reservationId).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;
  return reservationId;
}
