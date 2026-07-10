import { describe, it, expect } from "vitest";
import { isPostgresExclusionViolation, isPostgresUniqueViolation, SlotConflictError } from "./slot-conflict";

describe("SlotConflictError", () => {
  it("has default message", () => {
    expect(new SlotConflictError().message).toBe("該時段已被預訂，請重新選擇");
  });
});

describe("isPostgresExclusionViolation", () => {
  it("detects 23P01", () => {
    expect(isPostgresExclusionViolation({ code: "23P01" })).toBe(true);
  });

  it("rejects other codes", () => {
    expect(isPostgresExclusionViolation({ code: "23505" })).toBe(false);
  });
});

describe("isPostgresUniqueViolation", () => {
  it("detects 23505", () => {
    expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
  });
});
