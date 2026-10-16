import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Runs scripts/test-orders-rls-sql.sh (throwaway local PostgreSQL) inside `npm test`,
// so CI covers the SQL scenarios without editing ci.yml. GitHub's ubuntu runners ship
// PostgreSQL binaries under /usr/lib/postgresql/<n>/bin and run as a non-root user.
// Skipped where initdb is missing or the process is root (initdb refuses root).
function pgBin(): string | null {
  if (process.env.PG_BIN && existsSync(`${process.env.PG_BIN}/initdb`)) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).filter((v) => existsSync(`${base}/${v}/bin/initdb`));
  versions.sort((a, b) => Number(b) - Number(a));
  return versions[0] ? `${base}/${versions[0]}/bin` : null;
}
const bin = pgBin();
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const canRun = Boolean(bin) && !isRoot;
if (!canRun) console.warn(`[orders-rls-sql] skipped: ${!bin ? "no initdb found" : "running as root"}`);

// In GitHub Actions a silent skip would hide a lost check, so fail instead.
describe.runIf(Boolean(process.env.GITHUB_ACTIONS) && !canRun)("orders RLS SQL scenarios in CI", () => {
  it("has PostgreSQL binaries available on the CI runner", () => {
    expect({ bin, isRoot }).toEqual({ bin: expect.any(String), isRoot: false });
  });
});

describe.skipIf(!canRun)("orders anon INSERT revoke SQL scenarios (local PostgreSQL)", () => {
  it("passes every scenario in supabase/tests/orders-anon-insert-revoke.test.sql", () => {
    const out = execFileSync("bash", ["scripts/test-orders-rls-sql.sh"], {
      env: { ...process.env, PG_BIN: bin! },
      encoding: "utf8",
      timeout: 90_000,
    });
    expect(out).toContain("ok - migrated: anon direct insert is rejected");
    expect(out).toContain("ok - rollback: anon direct insert works again");
    expect(out).toContain("ok - re-apply: anon direct insert rejected again");
    expect(out).toContain("SQL scenarios: PASS");
  }, 120_000);
});
