import { afterEach, describe, expect, it } from "vitest";
import {
  __resetMemoryRateLimitForTests,
  getRateLimitGrade,
  getRateLimitMode,
  guestRateLimitId,
  rateLimit,
} from "./rate-limit";

const origUrl = process.env.UPSTASH_REDIS_REST_URL;
const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const origDisabled = process.env.RATE_LIMIT_DISABLED;
const origNode = process.env.NODE_ENV;
const origVercel = process.env.VERCEL_ENV;

afterEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = origUrl;
  process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
  process.env.RATE_LIMIT_DISABLED = origDisabled;
  Reflect.set(process.env, "NODE_ENV", origNode);
  process.env.VERCEL_ENV = origVercel;
  __resetMemoryRateLimitForTests();
});

describe("guestRateLimitId", () => {
  it("without phone uses IP only", () => {
    expect(guestRateLimitId("1.2.3.4", null)).toBe("ip:1.2.3.4");
  });

  it("with phone includes stable hash", () => {
    const a = guestRateLimitId("1.2.3.4", "0912345678");
    const b = guestRateLimitId("1.2.3.4", "0912-345-678");
    expect(a).toBe(b);
    expect(a).toMatch(/^ip:1\.2\.3\.4:ph:[a-f0-9]{16}$/);
  });

  it("different phones produce different keys", () => {
    const a = guestRateLimitId("1.2.3.4", "0912345678");
    const b = guestRateLimitId("1.2.3.4", "0987654321");
    expect(a).not.toBe(b);
  });
});

describe("getRateLimitMode / memory enforce", () => {
  it("uses memory when Upstash unset (not fail-open)", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.RATE_LIMIT_DISABLED;
    expect(getRateLimitMode()).toBe("memory");
    expect(getRateLimitGrade()).toBe("degraded_per_isolate");
  });

  it("reports distributed grade when Upstash env present", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    expect(getRateLimitMode()).toBe("upstash");
    expect(getRateLimitGrade()).toBe("distributed");
  });

  it("memory limiter rejects after quota", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetMemoryRateLimitForTests();
    for (let i = 0; i < 5; i++) {
      const r = await rateLimit("ip:test-login", "login");
      expect(r.success).toBe(true);
      expect(r.mode).toBe("memory");
    }
    const blocked = await rateLimit("ip:test-login", "login");
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
