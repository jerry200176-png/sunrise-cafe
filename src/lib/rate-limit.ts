import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { normalizePhone } from "@/lib/phone-utils";

export type RateLimitMode = "upstash" | "memory" | "disabled";

function isUpstashConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Production must never silently fail-open.
 * - Upstash configured → distributed limiter (A-grade evidence for rate-limit P0)
 * - Else → in-memory sliding window (**degraded**; per-isolate only — NOT A−/A alone)
 * - Explicit RATE_LIMIT_DISABLED=1 → disabled (local/tests only; blocked in production)
 */
export function getRateLimitMode(): RateLimitMode {
  if (isUpstashConfigured()) return "upstash";
  const prod =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (process.env.RATE_LIMIT_DISABLED === "1" && !prod) return "disabled";
  return "memory";
}

export type UpstashConfigValidation = {
  ok: boolean;
  mode_if_live: RateLimitMode;
  grade: "distributed" | "degraded_per_isolate" | "disabled";
  issues: string[];
};

/** Production configuration check — does not call Redis. */
export function validateUpstashConfig(env: NodeJS.ProcessEnv = process.env): UpstashConfigValidation {
  const issues: string[] = [];
  const url = env.UPSTASH_REDIS_REST_URL ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (!url) issues.push("UPSTASH_REDIS_REST_URL_missing");
  else if (!/^https:\/\/.+/i.test(url)) issues.push("UPSTASH_REDIS_REST_URL_invalid");
  if (!token) issues.push("UPSTASH_REDIS_REST_TOKEN_missing");
  else if (token.length < 20) issues.push("UPSTASH_REDIS_REST_TOKEN_short");
  if (issues.length === 0) {
    return { ok: true, mode_if_live: "upstash", grade: "distributed", issues: [] };
  }
  return {
    ok: false,
    mode_if_live: "memory",
    grade: "degraded_per_isolate",
    issues,
  };
}

export function rateLimitGrade(mode: RateLimitMode): "distributed" | "degraded_per_isolate" | "disabled" {
  if (mode === "upstash") return "distributed";
  if (mode === "disabled") return "disabled";
  return "degraded_per_isolate";
}

type WindowSpec = { requests: number; windowMs: number };

const WINDOW: Record<string, WindowSpec> = {
  login: { requests: 5, windowMs: 60_000 },
  booking: { requests: 5, windowMs: 60_000 },
  availability: { requests: 30, windowMs: 60_000 },
  guestLookup: { requests: 10, windowMs: 60_000 },
  api: { requests: 60, windowMs: 60_000 },
};

export type LimiterKey = keyof typeof WINDOW;

function makeUpstash(requests: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (!isUpstashConfigured()) return null;
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(requests, window),
    analytics: true,
  });
}

const upstashLimiters = {
  login: makeUpstash(5, "1 m"),
  booking: makeUpstash(5, "1 m"),
  availability: makeUpstash(30, "1 m"),
  guestLookup: makeUpstash(10, "1 m"),
  api: makeUpstash(60, "1 m"),
} as const;

/** Per-isolate memory store: key → timestamps */
const memoryBuckets = new Map<string, number[]>();

function memoryLimit(
  identifier: string,
  key: LimiterKey
): { success: boolean; limit: number; remaining: number; reset: number } {
  const spec = WINDOW[key];
  const bucketKey = `${key}:${identifier}`;
  const now = Date.now();
  const windowStart = now - spec.windowMs;
  const prev = memoryBuckets.get(bucketKey) ?? [];
  const recent = prev.filter((t) => t > windowStart);
  if (recent.length >= spec.requests) {
    const oldest = recent[0] ?? now;
    memoryBuckets.set(bucketKey, recent);
    return {
      success: false,
      limit: spec.requests,
      remaining: 0,
      reset: oldest + spec.windowMs,
    };
  }
  recent.push(now);
  memoryBuckets.set(bucketKey, recent);
  // Bound map growth in long-lived isolates
  if (memoryBuckets.size > 5000) {
    const first = memoryBuckets.keys().next().value;
    if (first) memoryBuckets.delete(first);
  }
  return {
    success: true,
    limit: spec.requests,
    remaining: Math.max(0, spec.requests - recent.length),
    reset: now + spec.windowMs,
  };
}

/** Test helper — clear memory buckets */
export function __resetMemoryRateLimitForTests() {
  memoryBuckets.clear();
}

/**
 * Sync phone hash for rate-limit keys.
 * Must NOT use Node `crypto` — middleware runs on Edge.
 */
function stableHash16(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + ((i & 7) << 3);
    h2 = Math.imul(h2, 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
  ).slice(0, 16);
}

/** Composite key: IP + hashed phone — slows phone enumeration across IPs. */
export function guestRateLimitId(ip: string, phone?: string | null): string {
  if (!phone?.trim()) return `ip:${ip}`;
  const hash = stableHash16(normalizePhone(phone));
  return `ip:${ip}:ph:${hash}`;
}

export async function rateLimit(
  identifier: string,
  key: LimiterKey
): Promise<{ success: boolean; limit: number; remaining: number; reset: number; mode: RateLimitMode }> {
  const mode = getRateLimitMode();
  if (mode === "disabled") {
    return { success: true, limit: 0, remaining: 0, reset: 0, mode };
  }
  if (mode === "upstash") {
    const limiter = upstashLimiters[key as keyof typeof upstashLimiters];
    if (!limiter) {
      // Misconfigured mid-flight — fall back to memory rather than open
      const mem = memoryLimit(identifier, key);
      return { ...mem, mode: "memory" };
    }
    try {
      const result = await limiter.limit(identifier);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        mode,
      };
    } catch {
      // Upstash outage → degraded memory enforce (never fail-open)
      const mem = memoryLimit(identifier, key);
      return { ...mem, mode: "memory" };
    }
  }
  const mem = memoryLimit(identifier, key);
  return { ...mem, mode };
}

export function getClientIp(request: Request): string {
  const forwarded = (request.headers as Headers).get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() ?? "unknown";
}
