import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectRefFromDbUrl,
  projectRefFromSupabaseUrl,
} from "../../scripts/apply-migration-reservation-preorder.mjs";

const root = process.cwd();

describe("reservation preorder production migration runner", () => {
  const runner = readFileSync(join(root, "scripts/apply-migration-reservation-preorder.mjs"), "utf8");
  const workflow = readFileSync(
    join(root, ".github/workflows/apply-migration-reservation-preorder.yml"),
    "utf8"
  );

  it("is single-migration, exact-confirmation, and fail-closed", () => {
    expect(runner).toContain('const VERSION = "20260921-reservation-preorder"');
    expect(runner).toContain('migration-reservation-preorder.sql');
    expect(runner).toContain("await sql.begin");
    expect(runner).toContain("project references do not match");
    expect(runner).toContain("service_role_only");
    expect(runner).toContain("c.confdeltype");
    expect(runner).toContain("reservation_preorder_items");
    expect(runner).toContain('split(".").pop()');
    expect(runner).not.toContain('pg_get_constraintdef(c.oid)');
    expect(runner).not.toContain("DROP TABLE");
    expect(runner).not.toContain("DELETE FROM");
  });

  it("matches direct and Supavisor connection formats without accepting ambiguity", () => {
    expect(projectRefFromSupabaseUrl("https://abc-123.supabase.co")).toBe("abc-123");
    expect(
      projectRefFromDbUrl("postgresql://postgres:pw@db.abc-123.supabase.co:5432/postgres")
    ).toBe("abc-123");
    expect(
      projectRefFromDbUrl("postgresql://postgres.abc-123:pw@aws-0-region.pooler.supabase.com:5432/postgres")
    ).toBe("abc-123");
    expect(
      projectRefFromDbUrl("postgresql://postgres%2Eabc-123:pw@aws-0-region.pooler.supabase.com:5432/postgres")
    ).toBe("abc-123");
    expect(
      projectRefFromDbUrl("postgresql://default:pw@provider.example.com:5432/postgres")
    ).toBeNull();
  });

  it("does not run from the generic deploy migration phase", () => {
    const productionWorkflow = readFileSync(
      join(root, ".github/workflows/production-deploy-migrate.yml"),
      "utf8"
    );
    expect(productionWorkflow).not.toContain("apply-migration-reservation-preorder.mjs");
  });

  it("requires the exact production confirmation and main SHA parity", () => {
    expect(workflow).toContain("APPLY_RESERVATION_PREORDER");
    expect(workflow).toContain("Verify deployed SHA before mutation");
    expect(workflow).toContain("Apply exact migration and verify catalog");
    expect(workflow).toContain("environment: Production");
    expect(workflow).toContain("cancel-in-progress: false");
  });
});
