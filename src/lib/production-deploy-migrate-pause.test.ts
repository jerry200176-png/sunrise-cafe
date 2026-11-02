import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (input: string) => unknown };
type Job = { if?: string; needs?: string | string[]; "continue-on-error"?: unknown };
type Workflow = { jobs: Record<string, Job> };
const workflow = yaml.load(readFileSync(join(process.cwd(), ".github/workflows/production-deploy-migrate.yml"), "utf8")) as Workflow;

// A skipped first job skips ordinary dependent jobs. The watch job uses always(),
// so its explicit deploy-success condition is necessary to keep it paused too.
function assertPaused({ jobs }: Workflow) {
  expect(Object.keys(jobs).sort()).toEqual([
    "deploy", "post_deploy_watch", "postdeploy_migrate", "postdeploy_verify", "predeploy_migrate", "predeploy_verify",
  ]);
  expect(jobs.predeploy_migrate.if).toBe("${{ false }}");
  expect(jobs.predeploy_migrate.needs).toBeUndefined();
  for (const [job, dependency] of [
    ["predeploy_verify", "predeploy_migrate"], ["deploy", "predeploy_verify"],
    ["postdeploy_migrate", "deploy"], ["postdeploy_verify", "postdeploy_migrate"],
  ]) {
    expect(jobs[job].needs).toBe(dependency);
    expect(jobs[job].if).toBeUndefined();
    expect(jobs[job]["continue-on-error"]).toBeUndefined();
  }
  expect(jobs.post_deploy_watch.needs).toEqual(["deploy", "postdeploy_verify"]);
  expect(jobs.post_deploy_watch.if).toBe("${{ always() && needs.deploy.result == 'success' }}");
}

describe("paused legacy deploy and migration workflow", () => {
  it("keeps the actual workflow's entire execution chain paused", () => assertPaused(workflow));
  it("rejects re-enabling the first migration job", () => {
    const changed = structuredClone(workflow);
    changed.jobs.predeploy_migrate.if = "${{ true }}";
    expect(() => assertPaused(changed)).toThrow();
  });
  it("rejects a job bypassing the skipped dependency", () => {
    const changed = structuredClone(workflow);
    changed.jobs.deploy.if = "${{ always() }}";
    expect(() => assertPaused(changed)).toThrow();
  });
  it("rejects the always-running watch losing its deploy-success guard", () => {
    const changed = structuredClone(workflow);
    changed.jobs.post_deploy_watch.if = "${{ always() }}";
    expect(() => assertPaused(changed)).toThrow();
  });
});
