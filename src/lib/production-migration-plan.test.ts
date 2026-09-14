import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executePhase,
  phaseEntries,
  phaseExecutionUnits,
  validateMigrationPlan,
} from "../../scripts/run-production-migration-phase.mjs";

const root = process.cwd();
const plan = JSON.parse(
  readFileSync(join(root, "scripts/production-migration-plan.json"), "utf8")
) as {
  schema_version: number;
  entries: Array<{
    version?: string;
    file: string;
    runner?: string;
    execution?: string;
    phase?: "predeploy" | "postdeploy";
  }>;
};
const contracts = JSON.parse(
  readFileSync(join(root, "supabase/tracked-migration-contracts.json"), "utf8")
) as Array<{ version: string; file: string }>;
const workflow = readFileSync(
  join(root, ".github/workflows/production-deploy-migrate.yml"),
  "utf8"
);

describe("explicit production migration plan", () => {
  it("requires an explicit phase for every executable entry", () => {
    expect(() => validateMigrationPlan(plan)).not.toThrow();
    expect(plan.schema_version).toBe(2);
    for (const entry of plan.entries.filter((item) => item.runner)) {
      expect(["predeploy", "postdeploy"]).toContain(entry.phase);
    }
    expect(plan.entries.find((entry) => entry.version === "20260914-bank-transfer-reports")?.phase).toBe(
      "predeploy"
    );
  });

  it("covers every tracked migration contract", () => {
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
    }
    expect(workflow).not.toMatch(/node scripts\/apply-migration-[\w-]+\.mjs/);
  });

  it("plans only the requested phase and deduplicates shared runners", () => {
    const predeployEntries = phaseEntries(plan, "predeploy") as typeof plan.entries;
    const postdeployEntries = phaseEntries(plan, "postdeploy") as typeof plan.entries;
    const postdeployUnits = phaseExecutionUnits(plan, "postdeploy") as typeof plan.entries;
    expect(predeployEntries.map((entry) => entry.version)).toEqual([
      "20260914-bank-transfer-reports",
    ]);
    expect(postdeployUnits.length).toBeLessThan(postdeployEntries.length);
    expect(postdeployUnits.every((entry) => entry.phase === "postdeploy")).toBe(true);
  });

  it("fails closed for unknown, missing, or duplicate phases", () => {
    expect(() => phaseEntries(plan, "unknown" as never)).toThrow(/Unknown migration phase/);
    expect(() =>
      validateMigrationPlan({
        schema_version: 2,
        entries: [{ file: "migration.sql", runner: "scripts/apply-migration-x.mjs" }],
      })
    ).toThrow(/no valid phase/);
    expect(() =>
      validateMigrationPlan({
        schema_version: 2,
        entries: [
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "predeploy" },
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "postdeploy" },
        ],
      })
    ).toThrow(/multiple phases/);
    expect(() =>
      validateMigrationPlan({
        schema_version: 2,
        entries: [
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "predeploy" },
          { version: "same", file: "migration.sql", runner: "scripts/apply-migration-x.mjs", phase: "predeploy" },
        ],
      })
    ).toThrow(/duplicated/);
  });

  it("does not run a postdeploy entry during predeploy", async () => {
    const calls: string[] = [];
    await executePhase(plan, "predeploy", async (runner) => calls.push(runner));
    expect(calls).toEqual(["scripts/apply-migration-bank-transfer-reports.mjs"]);
  });

  it("propagates predeploy failure so the dependent deploy cannot proceed", async () => {
    await expect(
      executePhase(plan, "predeploy", async () => {
        throw new Error("forced predeploy failure");
      })
    ).rejects.toThrow("forced predeploy failure");
  });

  it("treats already-applied and empty postdeploy phases as successful orchestration", async () => {
    const calls: string[] = [];
    const alreadyApplied = await executePhase(plan, "predeploy", async (runner) => {
      calls.push(runner);
      return { status: "already_applied" };
    });
    expect(alreadyApplied.phase).toBe("predeploy");
    expect(calls).toHaveLength(1);

    const emptyPlan = { schema_version: 2, entries: [] };
    const postdeploy = await executePhase(emptyPlan, "postdeploy", async () => {
      throw new Error("must not run");
    });
    expect(postdeploy.runners).toEqual([]);
  });

  it("enforces the migration phase dependency graph structurally", () => {
    const jobs = parseJobs(workflow);
    expect(needs(jobs, "predeploy_verify")).toEqual(["predeploy_migrate"]);
    expect(needs(jobs, "deploy")).toEqual(["predeploy_verify"]);
    expect(needs(jobs, "postdeploy_migrate")).toEqual(["deploy"]);
    expect(needs(jobs, "postdeploy_verify")).toEqual(["postdeploy_migrate"]);
    expect(jobs.get("predeploy_verify")).not.toMatch(/if:\s*always\(\)/);
    expect(jobs.get("deploy")).not.toMatch(/if:\s*always\(\)/);
    expect(jobs.get("predeploy_migrate")).toContain("node scripts/run-production-migration-phase.mjs predeploy");
    expect(jobs.get("postdeploy_migrate")).toContain("node scripts/run-production-migration-phase.mjs postdeploy");
  });
});

function parseJobs(source: string): Map<string, string> {
  const lines = source.split("\n");
  const jobs = new Map<string, string>();
  let current: string | null = null;
  let block: string[] = [];
  for (const line of lines) {
    const match = /^  ([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (match) {
      if (current) jobs.set(current, block.join("\n"));
      current = match[1];
      block = [];
    } else if (current) {
      block.push(line);
    }
  }
  if (current) jobs.set(current, block.join("\n"));
  return jobs;
}

function needs(jobs: Map<string, string>, job: string): string[] {
  const block = jobs.get(job);
  if (!block) throw new Error(`Missing workflow job ${job}`);
  const inline = /\n    needs:\s*([^\n]+)/.exec(`\n${block}`)?.[1]?.trim();
  if (!inline) return [];
  if (inline.startsWith("[")) return JSON.parse(inline.replaceAll("'", '"')) as string[];
  return [inline];
}
