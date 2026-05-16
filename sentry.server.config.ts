import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // 不在 server 端啟用 Session Replay
  // LINE Webhook、Cron Job、API routes 的錯誤都會被捕捉
});
