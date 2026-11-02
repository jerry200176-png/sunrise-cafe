import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertLinePayPaused } from "../../scripts/lib/linepay-paused-contract.mjs";

const root = resolve(__dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/ops-linepay-vercel-env.yml"), "utf8");
const script = readFileSync(resolve(root, "scripts/ops-linepay-vercel-env.sh"), "utf8");
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (input: string) => unknown };
type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { if?: string; permissions?: Record<string, string>; steps: Step[] };
const definition = yaml.load(workflow) as { permissions: Record<string, string>; jobs: Record<string, Job> };

describe("LINE Pay workflow credential isolation", () => {
  it("rejects credential, event and execution bypasses in the production workflow contract", () => {
    expect(() => assertLinePayPaused(workflow, script)).not.toThrow();
    for (const invalid of [
      workflow.replace("github.event_name == 'pull_request'", "true"),
      workflow.replace("runs-on: ubuntu-latest", "runs-on: self-hosted"),
      workflow.replace(/(  operate:[\s\S]*?runs-on: )ubuntu-latest/, "$1self-hosted"),
      workflow.replace("timeout-minutes: 15", "timeout-minutes: 999"),
      workflow.replace("timeout-minutes: 1\n", "timeout-minutes: 999\n"),
      workflow.replace("permissions: {}", "permissions:\n      actions: write"),
      workflow.replace("      - name: Explain paused operations", "      - continue-on-error: true\n        name: Explain paused operations"),
      workflow.replace("      - name: Explain paused operations", "      - if: false\n        name: Explain paused operations"),
      workflow.replace("exit 1", "exit 0"),
      workflow.replace("exit 1", "echo ${{ secrets.VERCEL_TOKEN }}\n          exit 1"),
      `${workflow}\n  another_job:\n    runs-on: ubuntu-latest\n    steps: []\n`,
    ]) {
      expect(() => assertLinePayPaused(invalid, script)).toThrow();
    }
    expect(() => assertLinePayPaused(workflow, `${script}\nnpx vercel env ls`)).toThrow();
  });

  it("keeps PR validation read-only and does not provide production credentials", () => {
    expect(definition.permissions).toEqual({ contents: "read" });
    const validate = definition.jobs.validate;
    expect(validate.if).toBe("github.event_name == 'pull_request'");
    expect(validate.permissions).toEqual({ contents: "read" });
    expect(validate.steps[0].with?.["persist-credentials"]).toBe(false);
    expect(validate.steps.filter((step) => step.run).map((step) => step.run)).toEqual([
      "npm ci", "npx vitest run src/lib/ops-linepay-vercel-env.test.ts",
    ]);
    expect(JSON.stringify(definition)).not.toContain("secrets.");
    expect(JSON.stringify(definition)).not.toContain("VERCEL_TOKEN");
    expect(JSON.stringify(definition)).not.toContain("actions:write");
  });

  it("allows only a main-branch manual dispatch and makes it fail without credentials", () => {
    const operate = definition.jobs.operate;
    expect(operate.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(operate.permissions).toEqual({});
    expect(operate.steps).toHaveLength(1);
    expect(operate.steps[0].uses).toBeUndefined();
    expect(operate.steps[0].env).toBeUndefined();
    expect(operate.steps[0].run?.trim()).toBe(
      "echo '::error::LINE Pay environment operations are paused until a reviewed safe path is available.'\nexit 1"
    );
  });

  it.each(["inspect", "", "set-sandbox-url", "restore-fixed-link", "unexpected"])(
    "blocks direct script execution in mode %s without invoking Vercel", (mode) => {
      const dir = mkdtempSync(resolve(tmpdir(), "linepay-paused-test-"));
      const marker = resolve(dir, "npx-called");
      const fakeNpx = resolve(dir, "npx");
      try {
        writeFileSync(fakeNpx, '#!/usr/bin/env bash\ntouch "$FAKE_MARKER"\nexit 1\n');
        chmodSync(fakeNpx, 0o700);
        const result = spawnSync("bash", [resolve(root, "scripts/ops-linepay-vercel-env.sh")], {
          cwd: dir,
          env: { NODE_ENV: "test", PATH: `${dir}:/usr/bin:/bin`, MODE: mode, VERCEL_TOKEN: "synthetic-token", FAKE_MARKER: marker },
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("operations are paused");
        expect(result.stderr).not.toContain("synthetic-token");
        expect(existsSync(marker)).toBe(false);
        expect(existsSync(resolve(dir, "out"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
