import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps the dedicated ops_events workflow on the verifier without a writing fallback", () => {
  const source = readFileSync(join(process.cwd(), ".github/workflows/apply-migration-ops-events.yml"), "utf8");
  expect(source).toContain("node scripts/apply-migration-ops-events.mjs");
  expect(source).not.toMatch(/curl\s|SUPABASE_DB_URL|CRON_SECRET|VERCEL_TOKEN|vercel-production-env|exit 0/);
});
