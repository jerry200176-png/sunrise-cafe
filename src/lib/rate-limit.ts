import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { normalizePhone } from "@/lib/phone-utils";

// 未設定 Upstash 時直接放行，不影響系統運作
function isUpstashConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function makeRatelimit(requests: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (!isUpstashConfigured()) return null;
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(requests, window),
    analytics: true,
  });
}

// 各端點限流規則（參考 Stripe、Vercel 的分層設計）
const limiters = {
  login: makeRatelimit(5, "1 m"), // 後台登入：暴力破解防護
  booking: makeRatelimit(5, "1 m"), // 訂位建立：防止假訂位洗版
  availability: makeRatelimit(30, "1 m"), // 時段查詢：防止爬蟲
  guestLookup: makeRatelimit(10, "1 m"), // 客人查詢/取消/改期：防電話枚舉
  api: makeRatelimit(60, "1 m"), // 其他 API：一般防護
} as const;

type LimiterKey = keyof typeof limiters;

/**
 * Sync phone hash for rate-limit keys.
 * Must NOT use Node `crypto` — middleware runs on Edge and crashes with
 * MIDDLEWARE_INVOCATION_FAILED when createHash is called.
 */
function stableHash16(input: string): string {
  // Dual FNV-1a → 16 hex chars (stable, Edge/browser/Node safe)
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
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const limiter = limiters[key];
  if (!limiter) return { success: true, limit: 0, remaining: 0, reset: 0 };

  const result = await limiter.limit(identifier);
  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}

export function getClientIp(request: Request): string {
  const forwarded = (request.headers as Headers).get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() ?? "unknown";
}
