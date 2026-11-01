import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), fromEnv: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: mocks.fromEnv } }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    limit = mocks.limit;
  },
}));

describe("configured shared limiter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic-token");
    mocks.limit.mockReset();
    mocks.fromEnv.mockReset().mockReturnValue({});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([
    [true, 4], [false, 0],
  ])("preserves a real SDK decision: success=%s", async (success, remaining) => {
    mocks.limit.mockResolvedValue({ success, limit: 5, remaining, reset: Date.now() + 1000 });
    const { rateLimit } = await import("./rate-limit");
    expect(await rateLimit("synthetic", "login")).toMatchObject({ success, remaining, mode: "upstash" });
  });

  it("rejects SDK timeout even when its success flag is true", async () => {
    mocks.limit.mockResolvedValue({ success: true, limit: 0, remaining: 0, reset: 0, reason: "timeout" });
    const { rateLimit } = await import("./rate-limit");
    expect(await rateLimit("synthetic", "login")).toMatchObject({ success: false, unavailable: true, mode: "upstash" });
  });

  it("rejects malformed provider responses", async () => {
    mocks.limit.mockResolvedValue({ success: "yes" });
    const { rateLimit } = await import("./rate-limit");
    expect(await rateLimit("synthetic", "login")).toMatchObject({ success: false, unavailable: true });
  });

  it("returns an unavailable result without leaking an exception", async () => {
    mocks.limit.mockRejectedValue(new Error("synthetic private error"));
    const { rateLimit } = await import("./rate-limit");
    const result = await rateLimit("synthetic", "login");
    expect(result).toMatchObject({ success: false, unavailable: true });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("logs a redacted per-category outage signal at most once per minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.limit.mockRejectedValue(new Error("sensitive provider detail"));
    const { rateLimit } = await import("./rate-limit");
    await rateLimit("private customer identifier", "login");
    await rateLimit("another identifier", "login");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ event: "rate_limiter_unavailable", limiter: "login" });
    vi.setSystemTime(70_000);
    await rateLimit("private customer identifier", "login");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to memory if configuration appears after module init", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    const { rateLimit } = await import("./rate-limit");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.invalid");
    expect(await rateLimit("synthetic", "login")).toMatchObject({ success: false, unavailable: true });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("does not crash at module load when the SDK constructor fails", async () => {
    mocks.fromEnv.mockImplementation(() => { throw new Error("synthetic configuration failure"); });
    const { rateLimit } = await import("./rate-limit");
    expect(await rateLimit("synthetic", "login")).toMatchObject({ success: false, unavailable: true });
  });

  it.each(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])("rejects an incomplete provider configuration (%s)", async (missing) => {
    vi.stubEnv(missing, "");
    const { rateLimit, getRateLimitMode } = await import("./rate-limit");
    expect(getRateLimitMode()).toBe("upstash");
    expect(await rateLimit("synthetic", "login")).toMatchObject({ success: false, unavailable: true });
  });
});
