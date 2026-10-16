import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

// Static safety contract for the cloud backup + isolated restore drill
// (CG-011). The workflow touches the production database, so these
// assertions guard its trigger surface, isolation and artifact scope.

const ROOT = join(__dirname, "../..");
const WORKFLOW = ".github/workflows/db-backup-restore-drill.yml";
const yaml = createRequire(join(ROOT, "package.json"))("js-yaml") as {
  load(src: string): unknown;
};

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  if?: string;
};

const raw = readFileSync(join(ROOT, WORKFLOW), "utf8");
// js-yaml (YAML 1.2) keeps `on` as a string key.
const wf = yaml.load(raw) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<
    string,
    {
      if?: string;
      "timeout-minutes"?: number;
      container?: { image: string } | string;
      services?: Record<string, Record<string, unknown>>;
      steps: Step[];
    }
  >;
};
const jobs = Object.values(wf.jobs);
const job = jobs[0];
const steps = job.steps;

describe("db-backup-restore-drill workflow (static)", () => {
  it("is dispatch-only with a validated age_recipient input", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(raw).not.toMatch(/^\s*(pull_request|pull_request_target|push|schedule|workflow_run):/m);
    const inputs = (wf.on.workflow_dispatch as { inputs: Record<string, { required: boolean }> })
      .inputs;
    expect(Object.keys(inputs)).toEqual(["age_recipient"]);
    expect(inputs.age_recipient.required).toBe(true);
    expect(raw).toContain("^age1[0-9a-z]{58}$");
    // The input is only read through env, never interpolated into a script.
    for (const s of steps) {
      expect(s.run ?? "").not.toContain("${{ inputs.");
    }
  });

  it("runs only on main with read-only token, serialized, bounded", () => {
    expect(jobs).toHaveLength(1);
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(wf.concurrency).toEqual({ group: "sunrise-db-backup", "cancel-in-progress": false });
    expect(job["timeout-minutes"]).toBe(30);
  });

  it("uses postgres:17 tooling and asserts pg_dump major >= 17", () => {
    const image = typeof job.container === "string" ? job.container : job.container?.image;
    expect(image).toBe("postgres:17");
    expect(raw).toMatch(/major < 17/);
  });

  it("restore target is a service with no published ports", () => {
    const services = job.services ?? {};
    expect(Object.keys(services)).toEqual(["restore-db"]);
    const svc = services["restore-db"];
    expect(svc.image).toBe("postgres:17");
    expect(svc).not.toHaveProperty("ports");
    expect(raw).not.toMatch(/^\s*ports:/m);
  });

  it("passes SUPABASE_DB_URL only via env to the source steps and never echoes it", () => {
    const withSecret = steps.filter((s) => JSON.stringify(s).includes("secrets."));
    expect(withSecret.map((s) => s.name)).toEqual([
      "Validate inputs and secret presence",
      "Source — read-only counts, pg_dump, read-only counts",
    ]);
    for (const s of withSecret) {
      expect(s.env?.SUPABASE_DB_URL).toBe("${{ secrets.SUPABASE_DB_URL }}");
      expect(s.run ?? "").not.toContain("${{ secrets.");
    }
    for (const s of steps) {
      const run = s.run ?? "";
      expect(run).not.toMatch(/(echo|printf)[^\n]*\$\{?(SUPABASE_DB_URL|DB_URL)\b/);
      expect(run).not.toMatch(/set -x|set -o xtrace/);
      if (run) expect(run).toMatch(/set -e?uo pipefail/);
    }
    const source = withSecret[1];
    expect(source.env?.PGOPTIONS).toBe("-c default_transaction_read_only=on");
    expect(source.run).toContain("--format=custom");
    expect(source.run).toContain("--no-owner");
    expect(source.run).toContain("--schema=public");
  });

  it("restores with exit-on-error into restore-db only and requires matching counts", () => {
    const restore = steps.find((s) => s.name === "Restore drill into isolated service DB");
    expect(restore?.env?.PGHOST).toBe("restore-db");
    expect(JSON.stringify(restore)).not.toContain("secrets.");
    expect(restore?.run).toContain("--exit-on-error");
    expect(restore?.run).toContain("--no-owner");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(restore?.run).toContain(`CREATE ROLE ${role} `);
    }
    expect(restore?.run).toContain('cmp -s "${PLAIN_DIR}/source.counts" "${PLAIN_DIR}/restore.counts"');
  });

  it("never prints dump contents", () => {
    for (const s of steps) {
      expect(s.run ?? "").not.toMatch(/cat [^\n]*\.dump|pg_restore [^\n]*(-f -|--file=-)/);
    }
  });

  it("uploads only the encrypted dump, its checksum and the manifest (SHA-pinned)", () => {
    const uploads = steps.filter((s) => s.uses?.startsWith("actions/upload-artifact"));
    expect(uploads).toHaveLength(1);
    const up = uploads[0];
    expect(up.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    const paths = String(up.with?.path)
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    expect(paths).toEqual([
      "drill-out/sunrise-public.dump.age",
      "drill-out/sunrise-public.dump.age.sha256",
      "drill-out/manifest.json",
    ]);
    expect(up.with?.["retention-days"]).toBe(14);
    for (const s of steps.filter((x) => x.uses)) {
      expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("encrypts with age, shreds plaintext, and cleans up on failure", () => {
    const enc = steps.find((s) => s.name?.startsWith("Encrypt dump"));
    expect(enc?.run).toContain('age --encrypt --recipient "${AGE_RECIPIENT}"');
    expect(enc?.run).toContain("shred -u");
    const cleanup = steps[steps.length - 1];
    expect(cleanup.if).toBe("always()");
    expect(cleanup.run).toContain("shred -u");
  });

  it("does not reuse the known-defective local backup scripts", () => {
    for (const s of steps) {
      expect(s.run ?? "").not.toMatch(/backup-db\.sh|restore-drill\.sh/);
    }
  });
});
