import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const workflow = readFileSync(join(process.cwd(), ".github/workflows/production-deploy-migrate.yml"), "utf8");
const deployJob = workflow.split("  deploy:\n")[1]?.split("  postdeploy_migrate:\n")[0] ?? "";
const preflightJob = workflow.split("  deployment_preflight:\n")[1]?.split("  predeploy_migrate:\n")[0] ?? "";
const preflightScript = preflightJob.split("        run: |\n")[1]?.split("\n\n")[0]
  ?.split("\n").map((line) => line.replace(/^          /, "")).join("\n") ?? "";
const postGateScript = workflow.split("          # Recheck immediately before the postdeploy runner. This is not a lock\n")[1]
  ?.split("\n      - name:")[0]?.split("\n").map((line) => line.replace(/^          /, "")).join("\n") ?? "";
const postBlock = workflow.split("      - name: Block postdeploy until deployment writers are fenced\n")[1]?.split("        run: |\n")[1]
  ?.split("\n      - ")[0]?.split("\n").map((line) => line.replace(/^          /, "")).join("\n") ?? "";
const script = deployJob.split("      - name: Deploy if SHA drift\n")[1]?.split("        run: |\n")[1]
  ?.split("\n\n")[0]?.split("\n").map((line) => line.replace(/^          /, "")).join("\n") ?? "";
const expected = "a".repeat(40);
const old = "b".repeat(40);
const deploymentId = "dpl_syntheticA";
const dirs: string[] = [];

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function run({ first = JSON.stringify({ commit: old }), second = JSON.stringify({ commit: expected, deployment_id: deploymentId }), token = "fake", deployStatus = 0, curlFailure = "", postdeploy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sunrise-deploy-gate-test-"));
  dirs.push(dir);
  const put = (name: string, data: string) => writeFileSync(join(dir, name), data, { mode: 0o755 });
  put("git", `#!/bin/sh\nprintf '%s\\n' '${expected}'\n`);
  put("curl", `#!/bin/sh\ncount=0\n[ ! -f "$TEST_DIR/count" ] || count=$(cat "$TEST_DIR/count")\necho $((count+1)) > "$TEST_DIR/count"\nif [ "$CURL_FAILURE" = "$count" ]; then exit 7; fi\nif [ "$count" = 0 ]; then cat "$TEST_DIR/first"; else cat "$TEST_DIR/second"; fi\n`);
  put("bash", `#!/bin/sh\necho called >> "$TEST_DIR/deploy"\nexit "$DEPLOY_STATUS"\n`);
  put("node", `#!/bin/sh\necho called >> "$TEST_DIR/migration"\n`);
  put("first", first); put("second", second); put("output", "");
  const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", "-c", postdeploy ? postGateScript : script], {
    env: { NODE_ENV: "test", PATH: `${dir}:/usr/bin:/bin`, TEST_DIR: dir, GITHUB_OUTPUT: join(dir, "output"), PRODUCTION_URL: "https://invalid.example", VERCEL_TOKEN: token, DEPLOY_STATUS: String(deployStatus), CURL_FAILURE: curlFailure, EXPECTED_DEPLOYMENT_ID: deploymentId },
    encoding: "utf8", timeout: 3000,
  });
  return { result, output: readFileSync(join(dir, "output"), "utf8"), migrationCalled: existsSync(join(dir, "migration")) };
}

describe("production deploy gate", () => {
  it("allows a verified current version without a deploy token", () => {
    const { result, output } = run({ first: JSON.stringify({ commit: expected, deployment_id: deploymentId }), token: "" });
    expect(result.status).toBe(0);
    expect(output).toContain(`deployment_id=${deploymentId}`);
  });
  it("does not accept the same commit without a deployment identity", () => {
    const { result, output } = run({ first: JSON.stringify({ commit: expected }) });
    expect(result.status).not.toBe(0);
    expect(output).toBe("");
  });
  it("blocks a different version without a token", () => {
    const { result, output } = run({ token: "" });
    expect(result.status).not.toBe(0);
    expect(output).toBe("");
  });
  it.each(["", "not-json", "{}", '{"commit":"short"}', '{"commit":null}'])("blocks an unknown initial version %s", (first) => {
    const { result, output } = run({ first });
    expect(result.status).not.toBe(0);
    expect(output).toBe("");
  });
  it("blocks a version request failure before attempting a deploy", () => {
    const { result, output } = run({ curlFailure: "0" });
    expect(result.status).not.toBe(0);
    expect(output).toBe("");
  });
  it("blocks command failure but keeps the runtime watch eligible", () => {
    const { result, output } = run({ deployStatus: 2 });
    expect(result.status).not.toBe(0);
    expect(output).toContain("deployment_attempted=true");
  });
  it("does not trust a zero exit when production remains on the old version", () => {
    const { result, output } = run({ second: JSON.stringify({ commit: old }) });
    expect(result.status).not.toBe(0);
    expect(output).toContain("deployment_attempted=true");
  });
  it("blocks a failed or malformed confirmation after a deploy attempt", () => {
    for (const options of [{ curlFailure: "1" }, { second: "{}" }, { second: '{"commit":"short"}' }, { second: JSON.stringify({ commit: expected }) }, { second: JSON.stringify({ commit: expected, deployment_id: "not-an-id" }) }]) {
      const { result, output } = run(options);
      expect(result.status).not.toBe(0);
      expect(output).toContain("deployment_attempted=true");
    }
  });
  it("records an observed deployment identity after the exact version is confirmed", () => {
    const { result, output } = run();
    expect(result.status).toBe(0);
    expect(output).toContain("deployment_attempted=true");
    expect(output).toContain(`deployment_id=${deploymentId}`);
  });
  it("blocks forced redeploy before predeploy migrations until identity can be verified", () => {
    const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", "-c", preflightScript], { env: { NODE_ENV: "test", FORCE_DEPLOY: "true" }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(workflow).toMatch(/predeploy_migrate:\n[\s\S]*?needs: deployment_preflight/);
  });
  it("also blocks ordinary releases before predeploy while writer fencing and D7 are unresolved", () => {
    const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", "-c", preflightScript], { env: { NODE_ENV: "test", FORCE_DEPLOY: "false" }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Release blocked");
  });
  it("hard-blocks postdeploy before checkout or database access", () => {
    const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", "-c", postBlock], { env: { NODE_ENV: "test" }, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Postdeploy is disabled");
    const job = workflow.split("  postdeploy_migrate:\n")[1]?.split("  postdeploy_verify:\n")[0] ?? "";
    expect(job.indexOf("Block postdeploy until deployment writers are fenced")).toBeLessThan(job.indexOf("actions/checkout"));
  });
  it.each([
    { first: JSON.stringify({ commit: old }) },
    { first: '{"commit":"short"}' },
    { first: JSON.stringify({ commit: expected }) },
    { first: JSON.stringify({ commit: expected, deployment_id: "dpl_other" }) },
    { first: "{}" },
    { curlFailure: "0" },
  ])("blocks postdeploy DDL if the recheck is stale or unknown", (options) => {
    const { result, migrationCalled } = run({ ...options, postdeploy: true });
    expect(result.status).not.toBe(0);
    expect(migrationCalled).toBe(false);
  });
  it("the isolated recheck accepts matching identity; the job remains separately blocked", () => {
    const { result, migrationCalled } = run({ first: JSON.stringify({ commit: expected, deployment_id: deploymentId }), postdeploy: true });
    expect(result.status).toBe(0);
    expect(migrationCalled).toBe(true);
  });
  it("watches failed deploy jobs without automatic rollback while postdeploy depends on success", () => {
    expect(deployJob).toContain("steps.production_deploy.outputs.deployment_attempted");
    expect(workflow).toMatch(/postdeploy_migrate:\n[\s\S]*?needs: deploy/);
    expect(workflow).toContain("always() && needs.deploy.result != 'skipped'");
    expect(workflow).toContain("Block postdeploy until deployment writers are fenced");
    expect(workflow).not.toContain("npx vercel rollback --yes");
  });
});
