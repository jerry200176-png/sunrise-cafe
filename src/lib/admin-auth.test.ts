import { describe, it, expect, afterEach } from "vitest";
import { getSessionSecret } from "./admin-auth";

const origSession = process.env.SESSION_SECRET;
const origPassword = process.env.ADMIN_PASSWORD;

afterEach(() => {
  process.env.SESSION_SECRET = origSession;
  process.env.ADMIN_PASSWORD = origPassword;
});

describe("getSessionSecret", () => {
  it("優先採用 SESSION_SECRET", () => {
    process.env.SESSION_SECRET = "sess";
    process.env.ADMIN_PASSWORD = "pw";
    expect(getSessionSecret()).toBe("sess");
  });

  it("未設 SESSION_SECRET 時向下相容使用 ADMIN_PASSWORD", () => {
    delete process.env.SESSION_SECRET;
    process.env.ADMIN_PASSWORD = "pw";
    expect(getSessionSecret()).toBe("pw");
  });

  it("兩者皆無時為 undefined", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
    expect(getSessionSecret()).toBeUndefined();
  });
});
