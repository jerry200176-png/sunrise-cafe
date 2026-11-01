import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectReferences, verifyCatalog, verifyReadiness } from "../../scripts/apply-migration-line-reminder-deliveries.mjs";

const checks = ["table_present", "columns_present", "reservation_columns_present", "id_primary", "reservation_foreign_key",
  "claim_unique", "function_shape", "service_execute", "service_table_access", "no_guest_execute"];
const passingRow = Object.fromEntries(checks.map((key) => [key, true]));

function fakeDatabase(row: Record<string, unknown> = passingRow, migrations: unknown[] = [{}]) {
  const tx = Object.assign(vi.fn(async () => migrations), {
    unsafe: vi.fn(async (query: string) => query.startsWith("SET LOCAL") ? [] : [row]),
  });
  const sql = { begin: vi.fn(async (_mode: string, fn: (transaction: typeof tx) => unknown) => fn(tx)) };
  return { sql, tx };
}

describe("LINE reminder non-mutating readiness", () => {
  it("binds the API host to a verified direct or Supavisor project", () => {
    expect(projectReferences("https://abc-123.supabase.co", "postgres://postgres:x@db.abc-123.supabase.co/postgres")).toBe("abc-123");
    expect(projectReferences("https://abc-123.supabase.co", "postgres://postgres%2Eabc-123:x@aws-0-region.pooler.supabase.com/postgres")).toBe("abc-123");
    expect(projectReferences("https://abc-123.supabase.co", "postgres://postgres.other:x@aws-0-region.pooler.supabase.com/postgres")).toBeNull();
    expect(projectReferences("https://abc-123.supabase.co", "postgres://postgres.abc-123:x@hostile.example/postgres")).toBeNull();
    expect(projectReferences("https://abc-123.supabase.co.attacker.test", "postgres://postgres:x@db.abc-123.supabase.co/postgres")).toBeNull();
    expect(projectReferences("https://abc-123.supabase.co/rest/v1", "postgres://postgres:x@db.abc-123.supabase.co/postgres")).toBeNull();
    expect(projectReferences("https://abc-123.supabase.co", "not-a-connection")).toBeNull();
  });

  it("reads the catalog and ledger in a read-only transaction", async () => {
    const { sql, tx } = fakeDatabase();
    await expect(verifyCatalog(sql)).resolves.toBeUndefined();
    expect(sql.begin).toHaveBeenCalledWith("isolation level repeatable read read only", expect.any(Function));
    expect(tx.unsafe).toHaveBeenCalledTimes(2);
    expect(tx.unsafe.mock.calls[0][0]).toBe("SET LOCAL search_path = pg_catalog");
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it.each(checks)("fails closed for missing or unproven %s", async (key) => {
    const { sql, tx } = fakeDatabase({ ...passingRow, [key]: false });
    await expect(verifyCatalog(sql)).rejects.toThrow("contract is incomplete");
    expect(tx).not.toHaveBeenCalled();
  });

  it("fails closed when the version is not recorded", async () => {
    const { sql } = fakeDatabase(passingRow, []);
    await expect(verifyCatalog(sql)).rejects.toThrow("ledger is missing");
  });

  it("never equates catalog checks with unproven REST or RPC cache readiness", async () => {
    const { sql } = fakeDatabase();
    await expect(verifyReadiness(sql))
      .rejects.toThrow("RPC schema cache is unverified; release remains blocked");
  });

  it("does not expose a synthetic credential on configuration failure", () => {
    const secret = "synthetic-private-" + "x".repeat(64);
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/apply-migration-line-reminder-deliveries.mjs")], {
      env: { PATH: process.env.PATH, NEXT_PUBLIC_SUPABASE_URL: "https://first.supabase.co",
        SUPABASE_DB_URL: `postgres://postgres:${secret}@db.other.supabase.co/postgres`,
        SUPABASE_SERVICE_ROLE_KEY: secret }, encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LINE reminder verification failed");
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("removes direct claim probes and ledger DDL from bootstrap and deployment workflow", () => {
    const root = process.cwd();
    const bootstrap = readFileSync(join(root, "src/lib/bootstrap-migrations.ts"), "utf8");
    const workflow = readFileSync(join(root, ".github/workflows/production-deploy-migrate.yml"), "utf8");
    expect(bootstrap).not.toContain("claim_line_reminder_delivery");
    expect(bootstrap).not.toContain("migration-line-reminder-deliveries.sql");
    expect(workflow).not.toContain("/rest/v1/rpc/claim_line_reminder_delivery");
    expect(workflow).toContain("node scripts/run-production-migration-phase.mjs postdeploy");
  });
});
