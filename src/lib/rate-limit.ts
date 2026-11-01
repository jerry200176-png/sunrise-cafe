import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { normalizePhone } from "@/lib/phone-utils";

export type RateLimitMode = "upstash" | "memory" | "disabled";

function isUpstashConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Production must never silently fail-open.
 * - Any Upstash setting present → shared limiter mode (configuration is not a connectivity check)
 * - Neither setting present → in-memory sliding window (**degraded**; per-isolate only)
 * - Explicit RATE_LIMIT_DISABLED=1 → disabled (local/tests only; blocked in production)
 */
export function getRateLimitMode(): RateLimitMode {
  // A partially configured provider is unavailable, not a choice of local limiting.
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  const prod =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (process.env.RATE_LIMIT_DISABLED === "1" && !prod) return "disabled";
  return "memory";
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
export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  mode: RateLimitMode;
  /** The shared limiter could not decide; this is not a quota rejection. */
  unavailable?: true;
};

const unavailableLogTimes = new Map<LimiterKey, number>();

function unavailable(key: LimiterKey): RateLimitResult {
  const now = Date.now();
  const last = unavailableLogTimes.get(key);
  if (last === undefined || now - last >= 60_000) {
    unavailableLogTimes.set(key, now);
    // Bounded per-isolate signal: no request identifier, path or provider error.
    try { console.warn(JSON.stringify({ event: "rate_limiter_unavailable", limiter: key })); } catch { /* keep the 503 response */ }
  }
  return { success: false, limit: 0, remaining: 0, reset: Date.now() + 5000, mode: "upstash", unavailable: true };
}

function makeUpstash(key: LimiterKey, requests: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (!isUpstashConfigured()) return null;
  try {
    return new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(requests, window),
      prefix: `sunrise:ratelimit:${key}`,
      analytics: true,
    });
  } catch {
    // Defer a configuration/constructor failure to the unavailable response.
    return null;
  }
}

const upstashLimiters = {
  login: makeUpstash("login", 5, "1 m"),
  booking: makeUpstash("booking", 5, "1 m"),
  availability: makeUpstash("availability", 30, "1 m"),
  guestLookup: makeUpstash("guestLookup", 10, "1 m"),
  api: makeUpstash("api", 60, "1 m"),
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
): Promise<RateLimitResult> {
  const mode = getRateLimitMode();
  if (mode === "disabled") {
    return { success: true, limit: 0, remaining: 0, reset: 0, mode };
  }
  if (mode === "upstash") {
    if (!isUpstashConfigured()) return unavailable(key);
    const limiter = upstashLimiters[key as keyof typeof upstashLimiters];
    if (!limiter) {
      // A configured shared limiter cannot be replaced with a per-isolate one.
      return unavailable(key);
    }
    try {
      const result = await limiter.limit(identifier);
      // Upstash reports success=true on its default timeout. That is not a decision.
      if (result.reason === "timeout") return unavailable(key);
      if (typeof result.success !== "boolean" || !Number.isFinite(result.limit) ||
          !Number.isFinite(result.remaining) || !Number.isFinite(result.reset)) return unavailable(key);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        mode,
      };
    } catch {
      // Do not expose provider errors, which may contain sensitive information.
      return unavailable(key);
    }
  }
  const mem = memoryLimit(identifier, key);
  return { ...mem, mode };
}

export function getClientIp(request: Request): string {
  const forwarded = (request.headers as Headers).get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() ?? "unknown";
}
