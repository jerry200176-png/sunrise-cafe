import { describe, expect, it } from "vitest";
import { signAttendanceToken, verifyAttendanceToken } from "./attendance-token";

describe("attendance-token", () => {
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
});
