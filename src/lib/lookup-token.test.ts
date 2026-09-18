import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signLookupToken, verifyLookupToken } from "./lookup-token";
import { signAttendanceToken } from "./attendance-token";

describe("lookup-token", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-key-12345";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it("signs and successfully verifies a valid token", () => {
    const resId = "550e8400-e29b-41d4-a716-446655440000";
    const token = signLookupToken(resId);
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);

    const result = verifyLookupToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe(resId);
    }
  });

  it("rejects expired tokens", () => {
    const resId = "res-expired-123";
    // TTL of -1000ms makes it immediately expired
    const token = signLookupToken(resId, -1000);
    const result = verifyLookupToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("expired");
    }
  });

  it("token for booking A never verifies as booking B", () => {
    const tokenA = signLookupToken("booking-A");
    const result = verifyLookupToken(tokenA);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe("booking-A");
      expect(result.reservationId).not.toBe("booking-B");
    }
  });

  it("rejects tampered reservationId payload", () => {
    const token = signLookupToken("res-original-1");
    const [, exp, mac] = token.split(".");
    const tamperedPayload = Buffer.from("res-tampered-2").toString("base64url");
    const tamperedToken = `${tamperedPayload}.${exp}.${mac}`;

    const result = verifyLookupToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("signature_mismatch");
    }
  });

  it("rejects tampered expiration timestamp", () => {
    const token = signLookupToken("res-1");
    const [payload, exp, mac] = token.split(".");
    const newExp = String(Number(exp) + 100000);
    const tamperedToken = `${payload}.${newExp}.${mac}`;

    const result = verifyLookupToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("signature_mismatch");
    }
  });

  it("rejects malformed token strings", () => {
    expect(verifyLookupToken("").ok).toBe(false);
    expect(verifyLookupToken("not-a-token").ok).toBe(false);
    expect(verifyLookupToken("a.b").ok).toBe(false);
    expect(verifyLookupToken("a.b.c.d").ok).toBe(false);
    expect(verifyLookupToken("a.notanumber.c").ok).toBe(false);
  });

  it("enforces domain separation from attendance tokens", () => {
    const resId = "550e8400-e29b-41d4-a716-446655440000";
    const attendanceToken = signAttendanceToken(resId);
    // Attendance token has 2 parts, lookup token has 3 parts
    expect(verifyLookupToken(attendanceToken).ok).toBe(false);
  });

  describe("key separation", () => {
    it("prioritizes dedicated GUEST_LOOKUP_SECRET over SESSION_SECRET", () => {
      process.env.GUEST_LOOKUP_SECRET = "dedicated-lookup-secret-abc";
      process.env.SESSION_SECRET = "general-session-secret-xyz";

      const token = signLookupToken("res-dedicated-1");
      expect(verifyLookupToken(token).ok).toBe(true);

      // Verifying with only SESSION_SECRET fails (proves GUEST_LOOKUP_SECRET was used)
      delete process.env.GUEST_LOOKUP_SECRET;
      expect(verifyLookupToken(token).ok).toBe(false);
    });

    it("never reuses or falls back to SUPABASE_SERVICE_ROLE_KEY", () => {
      delete process.env.GUEST_LOOKUP_SECRET;
      delete process.env.SESSION_SECRET;
      delete process.env.ADMIN_PASSWORD;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-admin-super-secret";

      const token = signLookupToken("res-isolated-1");
      // Changing SUPABASE_SERVICE_ROLE_KEY does not alter the signature
      process.env.SUPABASE_SERVICE_ROLE_KEY = "different-service-role-key";
      const result = verifyLookupToken(token);
      expect(result.ok).toBe(true);
    });
  });
});
