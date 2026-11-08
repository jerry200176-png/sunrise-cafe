import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { signAttendanceToken, verifyAttendanceToken } from "./attendance-token";

describe("attendance-token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips reservation id", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const token = signAttendanceToken(id);
    expect(verifyAttendanceToken(token)).toBe(id);
  });

  it("rejects tampered tokens", () => {
    const token = signAttendanceToken("abc");
    expect(verifyAttendanceToken(token + "x")).toBeNull();
    expect(verifyAttendanceToken("not.a.token")).toBeNull();
  });

  describe("production fail-closed", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GUEST_LOOKUP_SECRET", "");
      vi.stubEnv("SESSION_SECRET", "");
    });

    it.each(["ADMIN_PASSWORD", "CRON_SECRET"])("refuses with only %s", (name) => {
      vi.stubEnv(name, "some-secret");
      expect(() => signAttendanceToken("r1")).toThrow();
    });

    it("works with SESSION_SECRET", () => {
      vi.stubEnv("SESSION_SECRET", "session");
      expect(verifyAttendanceToken(signAttendanceToken("r1"))).toBe("r1");
    });

    it("rejects a token forged with the public dev keys", () => {
      vi.stubEnv("SESSION_SECRET", "session");
      for (const key of ["sunrise-attendance-dev", "sunrise-guest-lookup-dev-secret"]) {
        const mac = crypto.createHmac("sha256", key).update("r1").digest("base64url");
        const forged = `${Buffer.from("r1").toString("base64url")}.${mac}`;
        expect(verifyAttendanceToken(forged)).toBeNull();
      }
    });

    it("verify returns null (no throw) when unconfigured", () => {
      vi.stubEnv("NODE_ENV", "test");
      const t = signAttendanceToken("r1");
      vi.stubEnv("NODE_ENV", "production");
      expect(verifyAttendanceToken(t)).toBeNull();
    });
  });
});
