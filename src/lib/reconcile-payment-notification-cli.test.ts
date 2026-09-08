import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/reconcile-payment-notification.mjs");

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("reconcile-payment-notification CLI", () => {
  it("--help prints usage instructions and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("scripts/reconcile-payment-notification.mjs <reservation_id> [options]");
    expect(r.stdout).toContain("--mark-sent");
    expect(r.stdout).toContain("--safe-retry");
    expect(r.stdout).toContain("--dry-run");
  });

  it("fails with error when reservation_id is missing", () => {
    const r = run(["--mark-sent"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toContain("Missing required <reservation_id>");
  });

  it("fails with error when no action flag is specified", () => {
    const r = run(["00000000-0000-4000-8000-000000000001"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toContain("Must specify exactly one of --mark-sent, --safe-retry, or --dry-run");
  });

  it("fails with error when both --mark-sent and --safe-retry are specified", () => {
    const r = run(["00000000-0000-4000-8000-000000000001", "--mark-sent", "--safe-retry"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toContain("Must specify exactly one of --mark-sent, --safe-retry, or --dry-run");
  });

  it("fails with error when --dry-run and --mark-sent are specified together", () => {
    const r = run(["00000000-0000-4000-8000-000000000001", "--dry-run", "--mark-sent"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toContain("Must specify exactly one of --mark-sent, --safe-retry, or --dry-run");
  });
});
