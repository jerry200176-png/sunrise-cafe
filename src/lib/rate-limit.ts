import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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
  login: makeRatelimit(5, "1 m"),       // 後台登入：暴力破解防護
  booking: makeRatelimit(5, "1 m"),     // 訂位建立：防止假訂位洗版
  availability: makeRatelimit(30, "1 m"), // 時段查詢：防止爬蟲
  api: makeRatelimit(60, "1 m"),        // 其他 API：一般防護
} as const;

type LimiterKey = keyof typeof limiters;

export async function rateLimit(
  ip: string,
  key: LimiterKey
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const limiter = limiters[key];
  if (!limiter) return { success: true, limit: 0, remaining: 0, reset: 0 };

  const result = await limiter.limit(ip);
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
