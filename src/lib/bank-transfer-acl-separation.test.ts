import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runBankTransferMigration } from "../../scripts/apply-migration-bank-transfer-reports.mjs";
import { auditBankTransferAcl } from "../../scripts/audit-bank-transfer-acl.mjs";

const columns = ["reported_account_last_five", "reported_amount", "reported_at", "created_by", "updated_at", "updated_by", "reviewed_by"];
const functions = ["record_bank_transfer_report(uuid,text,numeric)", "confirm_bank_transfer_payment(uuid,text,text)"];
const goodPrivileges = {
  public_report: false, public_confirm: false,
  anon_report: false, anon_confirm: false,
  authenticated_report: false, authenticated_confirm: false,
  service_report: true, service_confirm: true,
};

function fakeDatabase(initiallyApplied: boolean, overrides: Record<string, unknown> = {}) {
  let applied = initiallyApplied;
  const unsafe = vi.fn(async (statement: string) => {
    if (!statement) throw new Error("Empty migration SQL");
    applied = true;
  });
  const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("information_schema.tables")) return [{}];
    if (query.includes("FROM schema_migrations")) return applied ? [{}] : [];
    if (query.includes("information_schema.columns")) return columns.map((column_name) => ({ column_name }));
    if (query.includes("FROM pg_indexes")) return [{}, {}];
    if (query.includes("has_function_privilege")) return [{ ...goodPrivileges, ...overrides }];
    if (query.includes("owner.rolname")) return functions.map((signature) => ({ signature, owner: "postgres", acl: "fake" }));
    if (query.includes("p.oid::regprocedure")) return functions.map((signature) => ({ signature }));
    throw new Error("Unexpected database query");
  }), {
    array: (value: unknown) => value,
    begin: vi.fn(async (optionsOrCallback, callback) => {
      if (typeof optionsOrCallback === "function") return optionsOrCallback({ unsafe });
      return callback(sql);
    }),
  });
  return { sql, unsafe };
}

describe("bank-transfer migration and ACL separation", () => {
  it("only reads when the migration is already applied and privileges match", async () => {
    const { sql, unsafe } = fakeDatabase(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(runBankTransferMigration(sql)).resolves.toBeUndefined();
      expect(sql.begin).toHaveBeenCalledWith("isolation level repeatable read read only", expect.any(Function));
      expect(unsafe).not.toHaveBeenCalled();
      const result = log.mock.calls.map(([message]) => JSON.parse(message as string)).find((message) => message.verification);
      expect(result.verification).toMatchObject({
        privileges: "checked_roles_match_policy",
        checked_roles: ["PUBLIC", "anon", "authenticated", "service_role"],
      });
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ["public_report", true], ["public_confirm", true],
    ["anon_report", true], ["anon_confirm", true],
    ["authenticated_report", true], ["authenticated_confirm", true],
    ["service_report", false], ["service_confirm", false],
    ["public_report", null],
  ])("stops without writes when %s is invalid", async (field, value) => {
    const { sql, unsafe } = fakeDatabase(true, { [field as string]: value });
    await expect(runBankTransferMigration(sql)).rejects.toThrow(/permission verification failed/);
    expect(sql.begin).toHaveBeenCalledWith("isolation level repeatable read read only", expect.any(Function));
    expect(unsafe).not.toHaveBeenCalled();
  });

  it("fails without writes when the historical migration is missing", async () => {
    const { sql, unsafe } = fakeDatabase(false);
    await expect(runBankTransferMigration(sql)).rejects.toThrow(/automatic bootstrap is disabled/);
    expect(sql.begin).toHaveBeenCalledWith("isolation level repeatable read read only", expect.any(Function));
    expect(unsafe).not.toHaveBeenCalled();
  });

  it("preserves the historical migration SQL", () => {
    const digest = createHash("sha256").update(readFileSync(resolve(__dirname, "../../supabase/migration-bank-transfer-reports.sql"))).digest("hex");
    expect(digest).toBe("64f5adaefa6197ad2b23add5e231b9119e768d5a176d051153da4e31c683a1ed");
  });

  it("runs the standalone audit inside a read-only transaction", async () => {
    const { sql, unsafe } = fakeDatabase(true);
    await expect(auditBankTransferAcl(sql)).resolves.toMatchObject({ privilege_probe: goodPrivileges });
    expect(sql.begin).toHaveBeenCalledWith("isolation level repeatable read read only", expect.any(Function));
    expect(unsafe).not.toHaveBeenCalled();
  });

  it("rejects apply options before connecting", () => {
    const result = spawnSync(process.execPath, [resolve(__dirname, "../../scripts/audit-bank-transfer-acl.mjs"), "--apply"], {
      env: { NODE_ENV: "test" }, encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("read-only; no options");
  });
});
