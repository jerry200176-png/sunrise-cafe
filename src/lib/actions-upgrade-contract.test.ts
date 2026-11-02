import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (text: string) => unknown };
type Step = { uses?: string; if?: string; id?: string; with?: Record<string, unknown> };
type Job = { if?: string; needs?: string | string[]; "runs-on"?: string; steps?: Step[] };
type Workflow = { jobs: Record<string, Job> };
const readWorkflow = (name: string) => yaml.load(readFileSync(join(process.cwd(), ".github/workflows", name), "utf8")) as Workflow;
const upload = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9";
const download = "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
const checkout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const node = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1";
const suffix = "${{ github.run_id }}-${{ github.run_attempt }}";
const artifactSteps = (job: Job, action: string) => (job.steps ?? []).filter((step) => step.uses?.startsWith(action));

function assertRecoveryContract(workflow: Workflow) {
  const release = workflow.jobs.release;
  const recovery = workflow.jobs.recovery;
  expect(release["runs-on"]).toBe("ubuntu-latest");
  expect(recovery["runs-on"]).toBe("ubuntu-latest");
  expect(recovery.needs).toEqual(["release", "verify-production"]);
  expect(recovery.if).toBe("${{ always() && (needs.release.result != 'success' || needs.verify-production.result != 'success') }}");
  const creates = artifactSteps(release, "actions/upload-artifact@");
  const gets = artifactSteps(recovery, "actions/download-artifact@");
  expect(creates).toHaveLength(2);
  expect(gets).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    const kind = i === 0 ? "baseline" : "candidate";
    const name = `code-only-${kind}-${suffix}`;
    expect(creates[i].uses).toBe(upload);
    expect(creates[i].with).toEqual({ archive: true, name,
      path: "${{ runner.temp }}/sunrise-code-only-" + kind + ".json", "retention-days": 7,
      "if-no-files-found": i === 0 ? "error" : "warn" });
    expect(gets[i].uses).toBe(download);
    expect(gets[i].with).toEqual({ name, path: "${{ runner.temp }}" });
  }
  expect(creates[0].if).toBeUndefined();
  expect(creates[1].if).toBe("${{ always() && steps.create.outcome != 'skipped' }}");
}

function assertBackupContract(workflow: Workflow) {
  expect(workflow.jobs.predeploy_migrate.if).toBe("${{ false }}");
  for (const kind of ["predeploy_migrate", "predeploy_verify", "postdeploy_migrate", "postdeploy_verify"]) {
    const job = workflow.jobs[kind];
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const steps = artifactSteps(job, "actions/upload-artifact@");
    expect(steps).toHaveLength(1);
    const step = steps[0];
    expect(step.id).toBe("upload");
    expect(step.uses).toBe(upload);
    expect(step.with).toEqual({ archive: true, name: `db-backup-${kind}-${suffix}`,
      path: "${{ steps.backup.outputs.artifact_path }}\n${{ steps.backup.outputs.manifest_path }}\n",
      "retention-days": 3, "if-no-files-found": "error" });
    const text = JSON.stringify(job);
    expect(text).toContain("steps.upload.outputs.artifact-id");
    expect(text).toContain("steps.upload.outputs.artifact-digest");
  }
}

describe("Actions update preserves artifact and recovery contracts", () => {
  it("retains production recovery names, contents, retention input and download pin", () => assertRecoveryContract(readWorkflow("production-code-only.yml")));
  it("retains encrypted backup shape and leaves migration disabled", () => assertBackupContract(readWorkflow("production-deploy-migrate.yml")));
  it("rejects a recovery archive/name/retention mutation", () => {
    for (const [key, value] of [["archive", false], ["name", "different"], ["retention-days", 1]] as const) {
      const w = readWorkflow("production-code-only.yml");
      artifactSteps(w.jobs.release, "actions/upload-artifact@")[0].with![key] = value;
      expect(() => assertRecoveryContract(w)).toThrow();
    }
  });
  it("rejects a backup artifact or pause mutation", () => {
    const w = readWorkflow("production-deploy-migrate.yml");
    artifactSteps(w.jobs.predeploy_migrate, "actions/upload-artifact@")[0].with!["if-no-files-found"] = "warn";
    expect(() => assertBackupContract(w)).toThrow();
    const enabled = readWorkflow("production-deploy-migrate.yml");
    enabled.jobs.predeploy_migrate.if = "${{ true }}";
    expect(() => assertBackupContract(enabled)).toThrow();
  });
  it("pins all checkout and setup-node actions and disables accidental auto cache", () => {
    const dir = join(process.cwd(), ".github/workflows");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".yml"))) {
      const w = readWorkflow(file);
      for (const job of Object.values(w.jobs ?? {})) for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@")) {
          expect(job["runs-on"], file).toBe("ubuntu-latest");
          expect(step.uses, file).toBe(checkout);
        }
        if (step.uses?.startsWith("actions/setup-node@")) {
          expect(job["runs-on"], file).toBe("ubuntu-latest");
          expect(step.uses, file).toBe(node);
          if (!step.with?.cache) expect(step.with?.["package-manager-cache"], file).toBe(false);
        }
        if (step.uses?.startsWith("actions/upload-artifact@")) {
          expect(job["runs-on"], file).toBe("ubuntu-latest");
          expect(step.uses, file).toBe(upload);
          // Both synthetic canaries deliberately exercise v7's archive default.
          const defaultArchiveCanaries = ["artifact-v7-canary.yml", "identity-recovery-canary.yml"];
          expect(step.with?.archive, file).toBe(defaultArchiveCanaries.includes(file) ? undefined : true);
        }
      }
    }
  });
});
