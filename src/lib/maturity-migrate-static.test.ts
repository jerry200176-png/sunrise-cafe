import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

describe("maturity migrations (static)", () => {
  it("RLS migration is idempotent and select-only", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migration-rls-catalog-read-only.sql"),
      "utf8"
    );
    expect(sql).toContain("ON CONFLICT (version) DO NOTHING");
    expect(sql).toContain("DROP POLICY IF EXISTS");
    expect(sql).toMatch(/FOR SELECT TO anon/);
    expect(sql).not.toMatch(/FOR ALL TO anon/);
  });

  it("refund migration is additive with RLS deny-by-default for anon", () => {
    const sql = readFileSync(join(ROOT, "supabase/migration-refund-requests.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS refund_requests");
    expect(sql).toContain("ON CONFLICT (version) DO NOTHING");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("controlled workflow requires production environment + APPLY confirm", () => {
    const yml = readFileSync(
      join(ROOT, ".github/workflows/production-maturity-migrate.yml"),
      "utf8"
    );
    expect(yml).toContain("environment: production");
    expect(yml).toContain("confirm");
    expect(yml).toContain("APPLY");
    expect(yml).toContain("maturity-migrate-preflight.mjs");
    expect(yml).toContain("maturity-post-migrate-probes.mjs");
  });
});
