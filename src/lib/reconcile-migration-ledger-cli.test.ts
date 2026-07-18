import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const SCRIPT = join(ROOT, "scripts/reconcile-migration-ledger.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig",
    },
  });
}

describe("reconcile-migration-ledger CLI", () => {
  it("refuses --apply without --migration", () => {
    const r = run(["--apply"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/--apply requires --migration/);
  });

  it("refuses --apply without --confirm-version", () => {
    const r = run(["--migration", "20260713-ops-events", "--apply"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/--confirm-version/);
  });

  it("refuses version mismatch between --migration and --confirm-version", () => {
    const r = run([
      "--migration",
      "20260713-ops-events",
      "--confirm-version",
      "20260710-phase7-rbac",
      "--apply",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/must exactly match/);
  });
});
