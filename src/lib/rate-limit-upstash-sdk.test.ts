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
