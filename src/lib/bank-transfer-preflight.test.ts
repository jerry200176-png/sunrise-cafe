import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verify } from "../../scripts/apply-migration-bank-transfer-reports.mjs";
import { verifyBankTransferReports } from "../../scripts/verify-bank-transfer-reports.mjs";

const columns = ["reported_account_last_five", "reported_amount", "reported_at", "created_by", "updated_at", "updated_by", "reviewed_by"];
const functions = ["record_bank_transfer_report(uuid,text,numeric)", "confirm_bank_transfer_payment(uuid,text,text)"];
const privileges = { public_report: false, public_confirm: false, anon_report: false, anon_confirm: false,
  authenticated_report: false, authenticated_confirm: false, service_report: true, service_confirm: true };

function catalog(overrides: { match: string; rows: unknown[] }[] = []) {
  const queries: string[] = [];
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray) => {
    const query = parts.join("?");
    queries.push(query);
    expect(query.trim()).toMatch(/^SELECT\b/);
    expect(query).not.toMatch(/\b(REVOKE|GRANT|INSERT|UPDATE|DELETE|CREATE|ALTER|claim_line_reminder_delivery)\b/i);
    const override = overrides.find(({ match }) => query.includes(match));
    if (override) return override.rows;
    if (query.includes("information_schema.tables")) return [{ present: 1 }];
    if (query.includes("information_schema.columns")) return columns.map((column_name) => ({ column_name }));
    if (query.includes("pg_indexes")) return [{}, {}];
    if (query.includes("AS public_report")) {
      expect(query).toContain("aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))");
      expect(query).toContain("a.grantee = 0");
      expect(query).not.toContain("has_function_privilege('public'");
      return [privileges];
    }
    if (query.includes("pg_proc")) return functions.map((signature) => ({ signature }));
    if (query.includes("schema_migrations")) return [{ present: 1 }];
    throw new Error(`Unexpected query: ${query}`);
  }), { array: (values: unknown[]) => values, queries });
  return sql;
}

describe("separate read-only migration verification", () => {
  it("verifies bank-transfer schema and privileges using only SELECTs", async () => {
    const sql = catalog();
    await expect(verify(sql)).resolves.toMatchObject({ privileges: "service_role_only" });
    expect(sql.queries.length).toBeGreaterThan(8);
  });

  it.each([
    ["information_schema.tables", []],
    ["information_schema.columns", []],
    ["pg_indexes", []],
    ["pg_proc", []],
    ["FROM schema_migrations", []],
    ["AS public_report", []],
    ["AS public_report", [{ ...privileges, anon_report: true }]],
    ["AS public_report", [{ ...privileges, public_report: true }]],
    ["AS public_report", [{ ...privileges, service_report: false }]],
    ["AS public_report", [{ ...privileges, public_report: null }]],
    ["AS public_report", [{ ...privileges, authenticated_confirm: undefined }]],
  ])("fails closed on catalog/ACL/ledger drift: %s", async (match, rows) => {
    await expect(verify(catalog([{ match: match as string, rows: rows as unknown[] }]))).rejects.toThrow();
  });

  it("passes only a read-only transaction to the verifier, never the application client", async () => {
    const transaction = catalog();
    const begin = vi.fn(async (mode: string, fn: (sql: unknown) => Promise<unknown>) => {
      expect(mode).toBe("read only");
      return fn(transaction);
    });
    await expect(verifyBankTransferReports({ begin })).resolves.toMatchObject({ privileges: "service_role_only" });
    expect(begin).toHaveBeenCalledOnce();
  });

  it("propagates probe errors without falling back to application", async () => {
    const transaction = vi.fn(async () => { throw new Error("catalog unavailable"); });
    const begin = vi.fn(async (_mode: string, fn: (sql: unknown) => Promise<unknown>) => fn(transaction));
    await expect(verifyBankTransferReports({ begin })).rejects.toThrow("catalog unavailable");
    expect(begin).toHaveBeenCalledOnce();
  });

  it("leaves deployment wiring and application phase dispatch unchanged", () => {
    const workflow = readFileSync(".github/workflows/production-deploy-migrate.yml", "utf8");
    const phase = readFileSync("scripts/run-production-migration-phase.mjs", "utf8");
    expect(workflow).not.toContain("verify-bank-transfer-reports.mjs");
    expect(phase).not.toContain("verify-bank-transfer-reports.mjs");
    const preflight = readFileSync("scripts/verify-bank-transfer-reports.mjs", "utf8");
    expect(preflight).not.toMatch(/repairRoleSpecificRpcPrivileges|\.unsafe\(|fetch\(|claim_line_reminder_delivery/);
  });
});
