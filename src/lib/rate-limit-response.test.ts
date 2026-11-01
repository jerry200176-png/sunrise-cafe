import { describe, expect, it } from "vitest";
import { rateLimitResponse } from "./rate-limit-response";
import type { RateLimitResult } from "./rate-limit";

const base: RateLimitResult = { success: false, limit: 5, remaining: 0, reset: Date.now() + 5000, mode: "upstash" };
describe("rateLimitResponse", () => {
  it("distinguishes unavailable from quota exhaustion", async () => {
    const unavailable = rateLimitResponse({ ...base, unavailable: true })!;
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "Service Temporarily Unavailable" });
    expect(Number(unavailable.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
    const exhausted = rateLimitResponse(base)!;
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toEqual({ error: "Too Many Requests" });
  });
  it("continues only on a real allowed result", () => {
    expect(rateLimitResponse({ ...base, success: true })).toBeNull();
    expect(rateLimitResponse({ ...base, success: true, unavailable: true })?.status).toBe(503);
  });
});
