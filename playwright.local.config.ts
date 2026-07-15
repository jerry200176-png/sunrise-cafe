import { defineConfig, devices } from "@playwright/test";

/** Local e2e against an already-running Next server (no webServer). */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    timezoneId: "Asia/Taipei",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
