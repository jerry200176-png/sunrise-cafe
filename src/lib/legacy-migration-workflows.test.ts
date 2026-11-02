import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// js-yaml is already included in the lockfile through the existing ESLint stack.
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (input: string) => unknown };

type Workflow = {
  on?: Record<string, unknown>;
  jobs?: Record<string, { if?: string; permissions?: Record<string, unknown>; steps?: Array<{ run?: string; uses?: string; env?: Record<string, string> }> }>;
};

describe("paused legacy migration workflows", () => {
  it.each([
    ["apply-migration-ops-events.yml", "scripts/apply-migration-ops-events.mjs"],
    ["apply-migration-market-parity.yml", "scripts/apply-migration-market-parity.mjs"],
    ["apply-migration-reminded-7d.yml", "scripts/apply-migration-reminded-7d.mjs"],
    ["apply-migration-line-reminder-deliveries.yml", "scripts/apply-migration-line-reminder-deliveries.mjs"],
    ["apply-migration-reservation-preorder.yml", "scripts/apply-migration-reservation-preorder.mjs"],
  ])("%s cannot execute automatically or from a manual dispatch", (file, runner) => {
    const path = join(process.cwd(), ".github", "workflows", file);
    const workflow = yaml.load(readFileSync(path, "utf8")) as Workflow;
    expect(Object.keys(workflow.on ?? {})).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.jobs ?? {}).sort()).toEqual(["apply", "paused"]);
    expect(workflow.jobs?.apply.if).toBe("${{ false }}");
    // Retain the old runner for review, without making it callable by the job.
    expect(workflow.jobs?.apply.steps?.some((step) => step.run?.includes(runner))).toBe(true);
    const notice = workflow.jobs?.paused;
    expect(notice?.if).toBeUndefined();
    expect(notice?.permissions).toEqual({});
    expect(notice?.steps).toHaveLength(1);
    expect(notice?.steps?.[0].uses).toBeUndefined();
    expect(notice?.steps?.[0].env).toBeUndefined();
    expect(notice?.steps?.[0].run?.trim()).toBe(
      "echo '::error::Migration is paused until an encrypted, retained backup and a reviewed migration path are verified.'\nexit 1"
    );
  });
});
