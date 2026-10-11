import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/components/payment/PaymentModal.test.tsx",
    ],
    // Keep setup minimal for node tests; component files opt into jsdom via pragma.
    setupFiles: ["./vitest.setup.ts"],
  },
});
