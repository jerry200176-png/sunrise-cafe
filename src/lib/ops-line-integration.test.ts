import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executePhase } from "../../scripts/run-production-migration-phase.mjs";

describe("ops and LINE conservative migration integration", () => {
  it("stops the phase when the actual ops runner cannot prove readiness", async () => {
    const plan = { schema_version: 2, entries: [
      { file: "migration-ops-events.sql", runner: "scripts/apply-migration-ops-events.mjs", phase: "postdeploy", sql_class: "additive" },
      { file: "sentinel.sql", runner: "scripts/synthetic-sentinel.mjs", phase: "postdeploy", sql_class: "additive" },
    ] };
    const called: string[] = [];
    await expect(executePhase(plan, "postdeploy", async (runner: string) => {
      called.push(runner);
      const result = spawnSync(process.execPath, [join(process.cwd(), runner)], {
        encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH },
      });
      if (result.status !== 0) throw new Error("readiness unverified");
    })).rejects.toThrow("readiness unverified");
    expect(called).toEqual(["scripts/apply-migration-ops-events.mjs"]);
  });

  it("does not restore old bootstrap SQL or LINE claim probes", () => {
    const bootstrap = readFileSync(join(process.cwd(), "src/lib/bootstrap-migrations.ts"), "utf8");
    expect(bootstrap).not.toMatch(/postgres|\.unsafe\s*\(|fetch\s*\(|claim_line_reminder_delivery|migration-.*\.sql/i);
  });
});
