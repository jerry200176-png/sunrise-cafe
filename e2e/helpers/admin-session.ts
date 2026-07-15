/**
 * Signed admin_session cookie for Playwright against `next start`.
 * Must match webServer ADMIN_PASSWORD / SESSION_SECRET (see playwright.config.ts).
 */
import type { BrowserContext } from "@playwright/test";
import {
  ADMIN_SESSION_COOKIE,
  createSignedAdminSession,
} from "../../src/lib/admin-api-auth";
import type { AdminRole } from "../../src/lib/rbac";

/** Must match playwright.config webServer ADMIN_PASSWORD / SESSION_SECRET. */
export const E2E_SESSION_SECRET =
  process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "e2e-admin-password";

export async function seedAdminSession(
  context: BrowserContext,
  claims: {
    role?: AdminRole;
    branch_ids?: string[] | null;
    legacy?: boolean;
  } = {}
) {
  const value = await createSignedAdminSession(E2E_SESSION_SECRET, 86400, {
    role: claims.role ?? "owner",
    branch_ids: claims.branch_ids === undefined ? null : claims.branch_ids,
    legacy: claims.legacy ?? true,
  });
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  await context.addCookies([
    {
      name: ADMIN_SESSION_COOKIE,
      value,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
