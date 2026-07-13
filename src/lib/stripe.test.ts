import { describe, it, expect, beforeEach, vi } from "vitest";

// 模擬環境變數
const mockEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  mockEnv.STRIPE_SECRET_KEY = undefined;
});

describe("getStripe", () => {
  it("throws when STRIPE_SECRET_KEY is missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", undefined as unknown as string);
    // 動態 import 以觸發讀取 env
    const { getStripe } = await import("./stripe");
    expect(() => getStripe()).toThrow("Missing STRIPE_SECRET_KEY");
  });

  it("returns singleton Stripe instance when key is set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake_key_12345");
    const { getStripe } = await import("./stripe");
    const instance1 = getStripe();
    const instance2 = getStripe();
    expect(instance1).toBe(instance2);
  });
});
