import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

/** Shared with e2e/helpers/admin-session.ts — production `next start` always requires auth. */
const E2E_ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "e2e-admin-password";
const E2E_SESSION_SECRET = process.env.SESSION_SECRET || E2E_ADMIN_PASSWORD;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // 與客人實際使用環境一致（台灣時區）；避免 slot 按鈕文字因 UTC 偏移而對不上
    timezoneId: "Asia/Taipei",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Guest booking is mostly used from iPhone Safari / LINE's in-app browser (WebKit on iOS).
    { name: "webkit", testMatch: ["booking-flow.spec.ts", "booking-reduced-motion.spec.ts", "preorder-recovery.spec.ts"], use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      SESSION_SECRET: E2E_SESSION_SECRET,
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder_anon_key",
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder_service_role_key",
    },
  },
});

