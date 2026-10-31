import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const dirs: string[] = [];
const leaked = "fake-channel-secret-12345";

function execute(scenario: string) {
  const cwd = mkdtempSync(resolve(tmpdir(), "linepay-evidence-"));
  dirs.push(cwd);
  const scripts = resolve(cwd, "scripts");
  mkdirSync(scripts);
  for (const file of ["run-linepay-vercel-env-safely.sh", "sanitize-linepay-report.py"]) {
    copyFileSync(resolve(root, "scripts", file), resolve(scripts, file));
  }
  writeFileSync(resolve(scripts, "ops-linepay-vercel-env.sh"), `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$OUT_DIR"
cat > "$OUT_DIR/linepay-vercel-env.txt" <<'REPORT'
=== LINE Pay Vercel env mode=inspect generated=fake ===
--- LINE Pay presence ---
LINE_PAY_API_BASE_URL=https://private.invalid/${leaked}
LINE_PAY_CHANNEL_ID=present len=10
LINE_PAY_CHANNEL_SECRET=present len=25
CURRENT_LINE_PAY_API_BASE_URL=https://private.invalid/${leaked}
INSPECT_ONLY: no Vercel env changed.
REPORT
echo 'private diagnostic ${leaked}'
if [[ "$SCENARIO" == leak_stdout ]]; then echo 'LINE_PAY_CHANNEL_SECRET=${leaked}'; fi
if [[ "$SCENARIO" == leak_report ]]; then echo 'LINE_PAY_CHANNEL_SECRET=${leaked}' >> "$OUT_DIR/linepay-vercel-env.txt"; fi
if [[ "$SCENARIO" == failure ]]; then echo '${leaked}' >&2; exit 1; fi
if [[ "$SCENARIO" == incomplete ]]; then sed -i '/INSPECT_ONLY/d' "$OUT_DIR/linepay-vercel-env.txt"; fi
`);
  const result = spawnSync("bash", [resolve(scripts, "run-linepay-vercel-env-safely.sh")], {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: cwd, TMPDIR: cwd, NODE_ENV: "test", MODE: "inspect", SCENARIO: scenario },
    encoding: "utf8",
  });
  const evidence = resolve(cwd, "out/linepay-vercel-env.txt");
  return { ...result, evidenceExists: existsSync(evidence), evidence: existsSync(evidence) ? readFileSync(evidence, "utf8") : "" };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("LINE Pay evidence publication", () => {
  it("publishes only reduced statuses, never raw diagnostics or an unknown URL", () => {
    const result = execute("success");
    expect(result.status).toBe(0);
    expect(result.evidenceExists).toBe(true);
    expect(result.evidence).toContain("LINE_PAY_API_BASE_URL=other-configured");
    expect(result.evidence).toContain("LINE_PAY_CHANNEL_SECRET=present");
    expect(result.stdout + result.stderr + result.evidence).not.toContain(leaked);
  });

  it.each(["leak_stdout", "leak_report", "failure", "incomplete"])(
    "fails closed and publishes no evidence for %s", (scenario) => {
      const result = execute(scenario);
      expect(result.status).not.toBe(0);
      expect(result.evidenceExists).toBe(false);
      expect(result.stdout + result.stderr).not.toContain(leaked);
    }
  );
});
