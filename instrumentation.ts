import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { runBootstrapMigrations } = await import("@/lib/bootstrap-migrations");
    void runBootstrapMigrations();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// 捕捉所有 server-side request 錯誤，包含 RSC、API routes、Cron
export const onRequestError = Sentry.captureRequestError;
