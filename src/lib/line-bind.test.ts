import { describe, it, expect } from "vitest";
import {
  parseLineBindPayload,
  encodeLineBindState,
  decodeLineBindState,
  extractPhoneFromText,
} from "./line-bind";

describe("parseLineBindPayload", () => {
  it("code only", () => {
    expect(parseLineBindPayload("ABC123")).toEqual({ bookingCode: "ABC123" });
  });

  it("code + phone", () => {
    expect(parseLineBindPayload("ABC123 0912345678")).toEqual({
      bookingCode: "ABC123",
      phone: "0912345678",
    });
  });

  it("non-bind text returns null", () => {
    expect(parseLineBindPayload("已匯款")).toBeNull();
  });
});

describe("line bind OAuth state", () => {
  it("round-trips code + phone", () => {
    const state = encodeLineBindState("abc123", "0912-345-678");
    expect(decodeLineBindState(state)).toEqual({
      bookingCode: "ABC123",
      phone: "0912345678",
    });
  });

  it("rejects non-bind state", () => {
    expect(decodeLineBindState("prebooking")).toBeNull();
  });
});

describe("extractPhoneFromText", () => {
  it("finds Taiwan mobile", () => {
    expect(extractPhoneFromText("我的電話 0912345678")).toBe("0912345678");
  });
});
