import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const script = readFileSync(resolve(root, "scripts/ops-linepay-vercel-env.sh"), "utf8");
const workflow = readFileSync(
  resolve(root, ".github/workflows/ops-linepay-vercel-env.yml"),
  "utf8"
);
const fixtureDirs: string[] = [];

function runScript(mode: string, token = "test-token") {
  const cwd = mkdtempSync(resolve(tmpdir(), "linepay-env-test-"));
  fixtureDirs.push(cwd);
  const calls = resolve(cwd, "calls.txt");
  const npx = resolve(cwd, "npx");
  writeFileSync(npx, `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$FAKE_CALLS"
if [[ "$1 $2" == "vercel link" ]]; then
  exit 0
elif [[ "$1 $2 $3" == "vercel env ls" ]]; then
  printf 'NAME TARGET CREATED AGE STATUS\\nLINE_PAY_CHANNEL_ID encrypted production now ready\\nLINE_PAY_CHANNEL_SECRET encrypted production now ready\\n'
elif [[ "$1 $2 $3" == "vercel env pull" ]]; then
  printf 'LINE_PAY_CHANNEL_ID=fake-channel-id-1234\\nLINE_PAY_CHANNEL_SECRET=fake-secret-value-1234\\nLINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me\\n' > "$4"
else
  echo 'unexpected command' >&2
  exit 1
fi
`);
  chmodSync(npx, 0o700);
  const result = spawnSync("bash", [resolve(root, "scripts/ops-linepay-vercel-env.sh")], {
    cwd,
    env: {
      PATH: `${cwd}:/usr/bin:/bin`, HOME: cwd, TMPDIR: cwd,
      NODE_ENV: "test", FAKE_CALLS: calls, MODE: mode, VERCEL_TOKEN: token,
    },
    encoding: "utf8",
  });
  let recorded = "";
  try { recorded = readFileSync(calls, "utf8"); } catch { /* no command was run */ }
  let report = "";
  try { report = readFileSync(resolve(cwd, "out/linepay-vercel-env.txt"), "utf8"); } catch { /* no report was produced */ }
  return { ...result, recorded, report };
}

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("LINE Pay Vercel sandbox env ops", () => {
  it("only allows the sandbox base URL mutation and never prints channel values", () => {
    expect(script).toContain("https://sandbox-api-pay.line.me");
    expect(script).toContain("MODE:-inspect");
    expect(script).toContain("shred");
    expect(script).toContain("CHANNEL_KEYS_PRESENT");
    expect(script).not.toContain("decrypt=true");
    expect(script).not.toMatch(/echo .*CHANNEL_SECRET/);
    expect(workflow).toContain("secrets.VERCEL_TOKEN");
    expect(script).toContain("restore-fixed-link");
    expect(workflow).toContain("set-sandbox-url");
    expect(workflow).toContain("restore-fixed-link");
    expect(workflow).not.toContain("chore/task-linepay-sandbox-land-20260815");
    expect(workflow).toContain("LINE_PAY_CHANNEL_(ID|SECRET)=[^[:space:]]{8,}");
    expect(workflow).not.toContain("LINE_PAY_CHANNEL_SECRET: ${{");
    expect(script).not.toContain("vercel redeploy");
    expect(script).not.toContain("/v13/deployments");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("gh workflow run production-deploy-migrate.yml");
  });

  it("gates real Vercel operations behind manual dispatch and keeps PR checks credential-free", () => {
    const prJob = workflow.split("  validate:")[1]?.split("  operate:")[0];
    const opsJob = workflow.split("  operate:")[1];
    expect(prJob).toContain("github.event_name == 'pull_request'");
    expect(prJob).toContain("ops-linepay-vercel-env.test.ts");
    expect(prJob).not.toContain("secrets.");
    expect(prJob).not.toContain("actions: write");
    expect(opsJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(opsJob).toContain("github.ref == 'refs/heads/main'");
    expect(opsJob).toContain("secrets.VERCEL_TOKEN");
    expect(opsJob).toContain("actions: write");
  });

  it("fails closed before running Vercel when the token is absent or mode is invalid", () => {
    const missing = runScript("inspect", "");
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("VERCEL_TOKEN unset");
    expect(missing.recorded).toBe("");

    const invalid = runScript("invalid-mode");
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("MODE_BLOCKED");
    expect(invalid.recorded).toBe("");
  });

  it("inspects fake values without leaking them or issuing a mutation", () => {
    const result = runScript("inspect");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("INSPECT_ONLY");
    expect(result.stdout).not.toContain("fake-channel-id-1234");
    expect(result.stdout).not.toContain("fake-secret-value-1234");
    expect(result.stderr).not.toContain("fake-channel-id-1234");
    expect(result.stderr).not.toContain("fake-secret-value-1234");
    expect(result.report).not.toContain("fake-channel-id-1234");
    expect(result.report).not.toContain("fake-secret-value-1234");
    expect(result.recorded).toContain("vercel env pull");
    expect(result.recorded).not.toMatch(/vercel env (?:add|rm)/);
  });
});
