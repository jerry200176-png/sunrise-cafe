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

function runScript(mode: string, token = "test-token", baseUrl = "https://sandbox-api-pay.line.me", listBase = false, safely = false, failSecondList = false) {
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
  if [[ "$FAKE_FAIL_SECOND_LIST" == 1 && -e "$FAKE_LIST_MARKER" ]]; then exit 1; fi
  touch "$FAKE_LIST_MARKER"
  printf 'NAME TARGET CREATED AGE STATUS\\nLINE_PAY_CHANNEL_ID encrypted production now ready\\nLINE_PAY_CHANNEL_SECRET encrypted production now ready\\n'
  if [[ "$FAKE_LIST_BASE" == 1 ]]; then printf 'LINE_PAY_API_BASE_URL encrypted production now ready\\n'; fi
elif [[ "$1 $2 $3" == "vercel env pull" ]]; then
  printf 'LINE_PAY_CHANNEL_ID=fake-channel-id-1234\\nLINE_PAY_CHANNEL_SECRET=fake-secret-value-1234\\nLINE_PAY_API_BASE_URL=%s\\n' "$FAKE_URL" > "$4"
elif [[ "$1 $2 $3" == "vercel env add" ]]; then
  cat > "$FAKE_INPUT"
else
  echo 'unexpected command' >&2
  exit 1
fi
`);
  chmodSync(npx, 0o700);
  const scriptName = safely ? "run-linepay-vercel-env-safely.sh" : "ops-linepay-vercel-env.sh";
  const result = spawnSync("bash", [resolve(root, "scripts", scriptName)], {
    cwd,
    env: {
      PATH: `${cwd}:/usr/bin:/bin`, HOME: cwd, TMPDIR: cwd,
      NODE_ENV: "test", FAKE_CALLS: calls, MODE: mode, VERCEL_TOKEN: token,
      FAKE_URL: baseUrl, FAKE_LIST_BASE: listBase ? "1" : "0", FAKE_INPUT: resolve(cwd, "input.txt"),
      FAKE_FAIL_SECOND_LIST: failSecondList ? "1" : "0", FAKE_LIST_MARKER: resolve(cwd, "listed"),
    },
    encoding: "utf8",
  });
  let recorded = "";
  try { recorded = readFileSync(calls, "utf8"); } catch { /* no command was run */ }
  let report = "";
  try { report = readFileSync(resolve(cwd, "out/linepay-vercel-env.txt"), "utf8"); } catch { /* no report was produced */ }
  let input = "";
  try { input = readFileSync(resolve(cwd, "input.txt"), "utf8"); } catch { /* no input was sent */ }
  return { ...result, recorded, report, input };
}

function runRestore(scenario: string) {
  const cwd = mkdtempSync(resolve(tmpdir(), "linepay-restore-test-"));
  fixtureDirs.push(cwd);
  const npx = resolve(cwd, "npx");
  const calls = resolve(cwd, "calls.txt");
  writeFileSync(npx, `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$FAKE_CALLS"
if [[ "$1 $2" == "vercel link" ]]; then exit 0; fi
if [[ "$1 $2 $3" == "vercel env ls" ]]; then
  count=0
  if [[ -e "$FAKE_COUNT" ]]; then count="$(cat "$FAKE_COUNT")"; fi
  count=$((count+1))
  echo "$count" > "$FAKE_COUNT"
  if [[ "$FAKE_SCENARIO" == list_failure && "$count" == 2 ]]; then exit 1; fi
  if [[ "$FAKE_SCENARIO" == preview_list_failure && "$count" == 9 ]]; then exit 1; fi
  printf 'NAME TARGET CREATED AGE STATUS\\n'
  for name in LINE_PAY_CHANNEL_ID LINE_PAY_CHANNEL_SECRET LINE_PAY_API_BASE_URL; do
    if ! grep -Fxq "$4:$name" "$FAKE_REMOVED" 2>/dev/null; then
      printf '%s encrypted %s now ready\\n' "$name" "$4"
    fi
  done
  if [[ "$FAKE_SCENARIO" == production_name_remains && "$count" == 8 ]]; then
    printf 'LINE_PAY_CHANNEL_ID encrypted production now ready\\n'
  fi
  if [[ "$FAKE_SCENARIO" == preview_remains && "$count" == 9 ]]; then
    printf 'LINE_PAY_CHANNEL_ID encrypted preview now ready\\n'
  fi
elif [[ "$1 $2 $3" == "vercel env pull" ]]; then
  count=0
  if [[ -e "$FAKE_PULL_COUNT" ]]; then count="$(cat "$FAKE_PULL_COUNT")"; fi
  count=$((count+1))
  echo "$count" > "$FAKE_PULL_COUNT"
  if [[ "$count" == 1 || "$FAKE_SCENARIO" == production_remains ]]; then
    printf 'LINE_PAY_CHANNEL_ID=fake-id-1234\\nLINE_PAY_CHANNEL_SECRET=fake-secret-1234\\nLINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me\\n' > "$4"
  else
    : > "$4"
  fi
elif [[ "$1 $2 $3" == "vercel env rm" ]]; then
  echo "$5:$4" >> "$FAKE_REMOVED"
else
  echo 'unexpected command' >&2
  exit 1
fi
`);
  chmodSync(npx, 0o700);
  const result = spawnSync("bash", [resolve(root, "scripts/run-linepay-vercel-env-safely.sh")], {
    cwd,
    env: {
      PATH: `${cwd}:/usr/bin:/bin`, HOME: cwd, TMPDIR: cwd, NODE_ENV: "test",
      MODE: "restore-fixed-link", VERCEL_TOKEN: "test-token", FAKE_SCENARIO: scenario,
      FAKE_CALLS: calls, FAKE_COUNT: resolve(cwd, "count"),
      FAKE_PULL_COUNT: resolve(cwd, "pull-count"), FAKE_REMOVED: resolve(cwd, "removed"),
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
    expect(workflow).toContain("run-linepay-vercel-env-safely.sh");
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
    expect(opsJob).toContain("persist-credentials: false");
    expect(opsJob.match(/if: always\(\) && steps\.inspect\.outcome == 'success'/g)).toHaveLength(2);
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

  it("only adds the exact sandbox URL when no value exists", () => {
    const missing = runScript("set-sandbox-url", "test-token", "", false);
    expect(missing.status).toBe(0);
    expect(missing.input).toBe("https://sandbox-api-pay.line.me");
    expect(missing.recorded).toContain("vercel env add LINE_PAY_API_BASE_URL production");

    const exact = runScript("set-sandbox-url", "test-token", "https://sandbox-api-pay.line.me", true);
    expect(exact.status).toBe(0);
    expect(exact.stdout).toContain("SANDBOX_URL_ALREADY_SET");
    expect(exact.recorded).not.toMatch(/vercel env (?:add|rm)/);
  });

  it("runs the actual inspect script through the evidence guard with a fake CLI", () => {
    const result = runScript("inspect", "test-token", "https://sandbox-api-pay.line.me", true, true);
    expect(result.status).toBe(0);
    expect(result.report).toContain("LINE_PAY_API_BASE_URL=sandbox");
    expect(result.report).toContain("LINE_PAY_CHANNEL_SECRET=present");
    expect(result.stdout + result.stderr + result.report).not.toContain("fake-secret-value-1234");
  });

  it.each([
    ["https://api-pay.line.me", true],
    ["https://api-pay.line.me", false],
    ["", true],
  ])("rejects a different or unreadable existing URL without changes", (url, listed) => {
    const result = runScript("set-sandbox-url", "test-token", url, listed);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("SANDBOX_URL_MISMATCH");
    expect(result.recorded).not.toMatch(/vercel env (?:add|rm)/);
  });

  it("withholds evidence when the real script rejects a conflicting URL", () => {
    const result = runScript("set-sandbox-url", "test-token", "https://api-pay.line.me", true, true);
    expect(result.status).not.toBe(0);
    expect(result.report).toBe("");
    expect(result.recorded).not.toMatch(/vercel env (?:add|rm)/);
    expect(result.stdout + result.stderr).not.toContain("fake-secret-value-1234");
    expect(result.stderr).toContain("no environment change was made");
  });

  it("does not add a URL when the second environment listing fails", () => {
    const result = runScript("set-sandbox-url", "test-token", "", false, true, true);
    expect(result.status).not.toBe(0);
    expect(result.report).toBe("");
    expect(result.recorded).not.toMatch(/vercel env (?:add|rm)/);
  });

  it("confirms removal in both environments before reporting a successful restore", () => {
    const result = runRestore("success");
    expect(result.status).toBe(0);
    expect(result.report).toContain("FIXED_LINK_RESTORED");
    expect(result.recorded.match(/vercel env rm /g)).toHaveLength(6);
    expect(result.stdout + result.stderr + result.report).not.toContain("fake-secret-1234");
  });

  it.each(["list_failure", "preview_list_failure", "production_remains", "production_name_remains", "preview_remains"])(
    "fails closed and withholds evidence when restore verification detects %s", (scenario) => {
      const result = runRestore(scenario);
      expect(result.status).not.toBe(0);
      expect(result.report).toBe("");
      expect(result.stdout + result.stderr).not.toContain("fake-secret-1234");
      if (scenario === "list_failure") expect(result.recorded).not.toContain("vercel env rm");
    }
  );
});
