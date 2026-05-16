import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // build time 上傳 source maps，讓 Sentry stack trace 可讀
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // 透過 /sentry-tunnel 繞過廣告攔截器，確保錯誤回報不漏失
  tunnelRoute: "/sentry-tunnel",
  // CI 以外靜音，避免 local build 噪音
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // 不自動建立 Sentry release（手動管理）
  autoInstrumentServerFunctions: true,
});