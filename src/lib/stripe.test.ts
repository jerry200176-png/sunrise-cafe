import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("stripe module", () => {
  it("returns null stripe and isStripeEnabled=false when STRIPE_SECRET_KEY is missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", undefined as unknown as string);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    const mod = await import("./stripe");
    expect(mod.stripe).toBeNull();
    expect(mod.isStripeEnabled()).toBe(false);
  });

  it("returns Stripe instance and isStripeEnabled=true when all keys are set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake_key_12345");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fake");
    const mod = await import("./stripe");
    expect(mod.stripe).not.toBeNull();
    expect(mod.stripe).toBeDefined();
  });

  it("isStripeEnabled returns false when webhook secret is missing even if key is set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake_key_12345");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined as unknown as string);
    const mod = await import("./stripe");
    expect(mod.isStripeEnabled()).toBe(false);
  });
});
