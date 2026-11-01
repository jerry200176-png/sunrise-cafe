import { afterEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ evalsha: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => ({ evalsha: calls.evalsha }) } }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("fails closed when the real Upstash SDK takes its default timeout path", async () => {
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic-token");
  calls.evalsha.mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  const { rateLimit } = await import("./rate-limit");
  const pending = rateLimit("synthetic", "login");
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toMatchObject({ success: false, unavailable: true, mode: "upstash" });
  expect(calls.evalsha).toHaveBeenCalled();
});

it("preserves the legacy shared Redis bucket across categories during rollout", async () => {
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic-token");
  const keys: string[][] = [];
  calls.evalsha.mockImplementation(async (_script: string, redisKeys: string[], args: number[]) => {
    keys.push(redisKeys);
    return [4, args[0]];
  });
  const { rateLimit } = await import("./rate-limit");
  const login = await rateLimit("synthetic-ip", "login");
  const availability = await rateLimit("synthetic-ip", "availability");
  expect(login.success).toBe(true);
  expect(availability.success).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toEqual(keys[1]);
  expect(keys[0][0]).toContain("@upstash/ratelimit:");
});
