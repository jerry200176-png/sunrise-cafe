import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(runner).not.toContain("DROP TABLE");
    expect(runner).not.toContain("DELETE FROM");
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
