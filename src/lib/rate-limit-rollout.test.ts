import { afterEach, beforeEach, expect, it, vi } from "vitest";

// This atomic in-memory model is not a Redis server or a cross-process test.
const store = vi.hoisted(() => ({ buckets: new Map<string, number>(), keys: [] as string[], hang: false }));
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => ({
  zincrby: async () => 1,
  evalsha: async (_hash: string, keys: string[], args: number[]) => {
    if (store.hang) return new Promise(() => {});
    const [current, previous] = keys;
    const [limit, now, window, increment] = args;
    store.keys.push(current);
    const count = store.buckets.get(current) ?? 0;
    const previousCount = Math.floor((1 - (now % window) / window) * (store.buckets.get(previous) ?? 0));
    if (count + previousCount >= limit) return [-1, limit];
    const next = count + increment;
    store.buckets.set(current, next);
    return [limit - next - previousCount, limit];
  },
}) } }));

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(1_800_000_001_000);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic-token");
  store.buckets.clear(); store.keys.length = 0; store.hang = false;
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function legacyLimiter() {
  const { Redis } = await import("@upstash/redis");
  const { Ratelimit } = await import("@upstash/ratelimit");
  // Matches the old main constructor: default prefix, 5 requests per minute.
  return new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(5, "1 m"), analytics: true });
}

it("shares the existing bucket across old and new SDK instances", async () => {
  const old = await legacyLimiter();
  const current = await import("./rate-limit");
  const decisions = [];
  for (let i = 0; i < 6; i++) {
    decisions.push(i % 2 ? (await current.rateLimit("synthetic-ip", "booking")).success : (await old.limit("synthetic-ip")).success);
  }
  expect(decisions).toEqual([true, true, true, true, true, false]);
  expect(new Set(store.keys).size).toBe(1);
  expect(store.keys[0]).toMatch(/^@upstash\/ratelimit:/);
});

it("deliberately retains existing cross-category contention", async () => {
  const current = await import("./rate-limit");
  for (let i = 0; i < 5; i++) expect((await current.rateLimit("synthetic-ip", "login")).success).toBe(true);
  expect((await current.rateLimit("synthetic-ip", "booking")).success).toBe(false);
});

it("old workers can still fail open on timeout until drained", async () => {
  const old = await legacyLimiter();
  const current = await import("./rate-limit");
  store.hang = true;
  const oldPending = old.limit("synthetic-ip");
  const newPending = current.rateLimit("synthetic-ip", "booking");
  await vi.advanceTimersByTimeAsync(5000);
  expect(await oldPending).toMatchObject({ success: true, reason: "timeout" });
  expect(await newPending).toMatchObject({ success: false, unavailable: true, mode: "upstash" });
});
