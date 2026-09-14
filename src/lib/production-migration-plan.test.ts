import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const plan = JSON.parse(
  readFileSync(join(root, "scripts/production-migration-plan.json"), "utf8")
) as {
  schema_version: number;
  entries: Array<{ version?: string; file: string; runner?: string; execution?: string }>;
};
const contracts = JSON.parse(
  readFileSync(join(root, "supabase/tracked-migration-contracts.json"), "utf8")
) as Array<{ version: string; file: string }>;
const workflow = readFileSync(
  join(root, ".github/workflows/production-deploy-migrate.yml"),
  "utf8"
);

describe("explicit production migration plan", () => {
  it("covers every tracked migration contract", () => {
    expect(plan.schema_version).toBe(1);
    const planned = new Set(plan.entries.map((entry) => `${entry.version}:${entry.file}`));
    for (const contract of contracts) {
      expect(planned.has(`${contract.version}:${contract.file}`)).toBe(true);
    }
  });

  it("maps every executable entry to a checked-in SQL file and runner", () => {
    for (const entry of plan.entries) {
      expect(() => readFileSync(join(root, "supabase", entry.file))).not.toThrow();
      if (!entry.runner) {
        expect(entry.execution).toBe("manual_sql_editor");
        continue;
      }
      expect(entry.runner).toMatch(/^scripts\/apply-migration-[\w-]+\.mjs$/);
      const runnerSource = readFileSync(join(root, entry.runner), "utf8");
      expect(runnerSource).toContain(entry.file);
      expect(workflow).toContain(`node ${entry.runner}`);
    }
  });

  it("does not allow an explicit workflow runner to escape the plan", () => {
    const workflowRunners = workflow.match(/scripts\/apply-migration-[\w-]+\.mjs/g) ?? [];
    const plannedRunners = new Set(plan.entries.map((entry) => entry.runner).filter(Boolean));
    for (const runner of new Set(workflowRunners)) {
      expect(plannedRunners.has(runner)).toBe(true);
    }
  });
});
