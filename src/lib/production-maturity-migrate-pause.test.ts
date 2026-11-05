import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (source: string) => unknown };
type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string> };
type Job = { if?: string; needs?: string | string[]; "runs-on"?: string; "timeout-minutes"?: number;
  permissions?: Record<string, string>; environment?: unknown; env?: unknown; steps: Step[] };
type Workflow = { on: Record<string, unknown>; env?: unknown; jobs: Record<string, Job> };
const source = readFileSync(join(process.cwd(), ".github/workflows/production-maturity-migrate.yml"), "utf8");
const workflow = yaml.load(source) as Workflow;
const notice = "echo '::error::Migration is paused until an encrypted, retained backup and a reviewed migration path are verified.'\nexit 1";

function assertPaused(w: Workflow) {
  expect(Object.keys(w.on)).toEqual(["workflow_dispatch"]);
  expect(w.env).toBeUndefined();
  expect(Object.keys(w.jobs).sort()).toEqual(["apply", "guard", "preflight", "probe", "summary"]);
  const guard = w.jobs.guard;
  expect(Object.keys(guard).sort()).toEqual(["name", "permissions", "runs-on", "steps", "timeout-minutes"]);
  expect(guard["runs-on"]).toBe("ubuntu-latest");
  expect(guard["timeout-minutes"]).toBe(1);
  expect(guard.permissions).toEqual({});
  expect(guard.steps).toHaveLength(1);
  expect(Object.keys(guard.steps[0]).sort()).toEqual(["name", "run"]);
  expect(guard.steps[0].run?.trim()).toBe(notice);
  for (const [job, needs] of [["preflight", "guard"], ["apply", "preflight"], ["probe", "apply"], ["summary", ["probe"]]] as const) {
    expect(w.jobs[job].needs).toEqual(needs);
    expect(w.jobs[job].if).toBe("${{ false }}");
  }
}

describe("paused maturity migration workflow", () => {
  it("fails at a credential-free guard and disables every later job", () => {
    assertPaused(workflow);
    const result = spawnSync("bash", ["-e", "-c", workflow.jobs.guard.steps[0].run!], {
      encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("::error::Migration is paused until an encrypted, retained backup and a reviewed migration path are verified.");
    expect(result.stderr).toBe("");
  });
  it.each(["preflight", "apply", "probe", "summary"])("rejects re-enabling %s", (name) => {
    const changed = structuredClone(workflow);
    changed.jobs[name].if = "${{ true }}";
    expect(() => assertPaused(changed)).toThrow();
  });
  it("rejects a successful or credential-bearing guard", () => {
    const successful = structuredClone(workflow);
    successful.jobs.guard.steps[0].run = "exit 0";
    expect(() => assertPaused(successful)).toThrow();
    const secret = structuredClone(workflow);
    secret.jobs.guard.steps[0].env = { TOKEN: "${{ secrets.TOKEN }}" };
    expect(() => assertPaused(secret)).toThrow();
    const checkout = structuredClone(workflow);
    checkout.jobs.guard.steps.push({ uses: "actions/checkout@example" });
    expect(() => assertPaused(checkout)).toThrow();
  });
  it("rejects a dependency bypass or always-running summary", () => {
    const changed = structuredClone(workflow);
    changed.jobs.apply.needs = "guard";
    expect(() => assertPaused(changed)).toThrow();
    const always = structuredClone(workflow);
    always.jobs.summary.if = "always()";
    expect(() => assertPaused(always)).toThrow();
  });
});
