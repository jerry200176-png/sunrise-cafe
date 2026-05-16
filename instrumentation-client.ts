import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",

  // 生產環境取樣 10%（控制費用）；dev 全取以便偵錯
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay：正常 10%，出錯時 100%（幫助重現問題）
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [Sentry.replayIntegration()],

  // 排除已知的非問題錯誤，降低雜訊
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    /^Loading chunk \d+ failed/,
    "NetworkError when attempting to fetch resource",
    "Failed to fetch",
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
