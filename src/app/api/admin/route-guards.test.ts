import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every admin API route must check a role (requirePermission / getAdminContext), not only "is signed in".
 * 2026-11-20: a new route shipped to review with login-only auth; this makes that a red test instead of a review finding.
 * The list below is the routes that predate this check. It may only shrink.
 */
const LOGIN_ONLY_LEGACY = [ // paths relative to src/app/api/admin
  "diagnose-line/route.ts",
  "login/route.ts",
  "logout/route.ts",
  "reminders/[id]/route.ts",
  "reminders/deploy-health/route.ts",
  "reminders/deposit-deadline/route.ts",
  "reminders/send-line-7d/route.ts",
  "reminders/send-line/route.ts",
  "reminders/verify/route.ts",
  "test-line-group/route.ts",
];

const dir = join(process.cwd(), "src/app/api/admin");
const routes = (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.replaceAll("\\", "/")).filter((p) => /\/route\.[cm]?[jt]sx?$/.test(p));
// Comments are removed first so a commented-out call does not count.
const code = (p: string) => readFileSync(join(dir, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const checksRole = (p: string) => /\bawait (requirePermission|getAdminContext)\(/.test(code(p));

describe("admin API routes", () => {
  it("check a role, except the listed legacy routes", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.filter((p) => !checksRole(p)).sort()).toEqual([...LOGIN_ONLY_LEGACY].sort());
  });
});
