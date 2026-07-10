import { createHmac } from "crypto";
import type { Page } from "@playwright/test";

export const E2E_ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "e2e-test-admin-password";

/** Mirrors src/lib/admin-api-auth createSignedAdminSession for Playwright cookies */
export function createSignedAdminSession(
  secret: string,
  maxAgeSec = 86400
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iat: now, exp: now + maxAgeSec });
  const encoded = Buffer.from(payload, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sig = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${encoded}.${sig}`;
}

export async function setAdminSessionCookie(page: Page, baseURL: string) {
  const url = new URL(baseURL);
  const session = createSignedAdminSession(E2E_ADMIN_PASSWORD);
  await page.context().addCookies([
    {
      name: "admin_session",
      value: session,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
