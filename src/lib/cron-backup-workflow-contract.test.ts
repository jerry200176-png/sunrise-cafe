import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yaml = createRequire(import.meta.url)("js-yaml") as { load: (source: string) => unknown };
function workflowScript(file: string, job: string, name: string): string {
  const workflow = yaml.load(readFileSync(join(process.cwd(), ".github/workflows", file), "utf8")) as {
    jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
  };
  const script = workflow.jobs[job].steps.find((step) => step.name === name)?.run;
  if (!script) throw new Error(`Missing workflow step ${name}`);
  return script;
}

function runWorkflow(script: string, options: { status?: string; body?: string; direct?: string; secret?: string; transport?: boolean } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "sunrise-cron-workflow-"));
  try {
    const bin = join(temp, "bin"); mkdirSync(bin);
    writeFileSync(join(bin, "node"), '#!/bin/sh\nexit "${SYNTHETIC_DIRECT_EXIT:-1}"\n', { mode: 0o755 });
    writeFileSync(join(bin, "curl"), `#!/bin/bash
set -eu
out=""; url=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o|-w|-H|-X) option="$1"; shift; [ "$option" != "-o" ] || out="$1";; http*) url="$1";; esac
  shift
done
touch "$RUNNER_TEMP/curl-called"
case "$url" in
  */verify|*/apply-ops-events)
    [ "\${SYNTHETIC_TRANSPORT_FAIL:-0}" != 1 ] || exit 7
    printf '%s' "$SYNTHETIC_BODY" > "$out"
    printf '%s' "$SYNTHETIC_STATUS";;
  */send-line) printf '%s' '{"result":"sent"}' > "$out"; printf 200;;
  *) exit 9;;
esac
`, { mode: 0o755 });
    const localScript = script.replaceAll("/tmp/send-line-1.json", join(temp, "send-1.json"))
      .replaceAll("/tmp/send-line-2.json", join(temp, "send-2.json"))
      .replaceAll("/tmp/verify.json", join(temp, "verify.json"));
    const result = spawnSync("bash", ["-c", localScript], {
      cwd: temp, encoding: "utf8", timeout: 10_000,
      env: { NODE_ENV: "test", PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp,
        PROD_URL: "https://synthetic.invalid", SUPABASE_DB_URL: "synthetic",
        CRON_SECRET: options.secret ?? "synthetic-secret", VERCEL_TOKEN: "",
        SYNTHETIC_DIRECT_EXIT: options.direct ?? "1", SYNTHETIC_STATUS: options.status ?? "200",
        SYNTHETIC_BODY: options.body ?? '{"ok":true}', SYNTHETIC_TRANSPORT_FAIL: options.transport ? "1" : "0" },
    });
    return { status: result.status, curlCalled: existsSync(join(temp, "curl-called")), output: result.stdout + result.stderr };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

describe("reminder backup verification workflow", () => {
  const script = workflowScript("send-line-reminder-backup.yml", "trigger", "Resolve CRON_SECRET + run send-line twice + verify");
  it("accepts the route's HTTP 200 and ok:true success contract", () => {
    expect(runWorkflow(script, { body: '{"ok":true,"report":{}}' }).status).toBe(0);
  });
  it.each([
    ["503", '{"error":"Service Temporarily Unavailable"}'],
    ["500", '{"ok":false}'], ["200", '{"ok":false}'], ["200", '{}'], ["200", 'not-json'],
    ["200", '{"ok":true,"message":"ledger unavailable"}'],
  ])("rejects HTTP %s with unsuccessful or invalid response", (status, body) => {
    expect(runWorkflow(script, { status, body }).status).not.toBe(0);
  });
  it("rejects a transport failure", () => expect(runWorkflow(script, { transport: true }).status).not.toBe(0));
});

describe("ops-events migration workflow", () => {
  const script = workflowScript("apply-migration-ops-events.yml", "apply", "Verify without applying SQL");
  it("propagates a mocked verifier success without calling the fallback", () => {
    const result = runWorkflow(script, { direct: "0" });
    expect(result.status).toBe(0); expect(result.curlCalled).toBe(false);
  });
  it.each(["", "synthetic-secret"])("does not call a writing fallback after direct runner failure (secret=%s)", (secret) => {
    const result = runWorkflow(script, { direct: "1", secret });
    expect(result.status).not.toBe(0);
    expect(result.curlCalled).toBe(false);
  });
});
