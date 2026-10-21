import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPlanSqlGate, lintSql, stripSql } from "../../scripts/lib/sql-additive-lint.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(join(root, "scripts/production-migration-plan.json"), "utf8"));
const read = (file: string) => readFileSync(join(root, "supabase", file), "utf8");
const rules = (sql: string) => lintSql(sql).map((f: { rule: string }) => f.rule);

describe("additive-only SQL linter", () => {
  it.each([
    ["DROP TABLE t;", "drop"],
    ["ALTER TABLE t DROP COLUMN c;", "drop"],
    ["ALTER TABLE t DROP CONSTRAINT x, ADD CONSTRAINT x CHECK (a > 0);", "drop"],
    ["ALTER TABLE t RENAME COLUMN a TO b;", "rename"],
    ["ALTER TABLE t ALTER COLUMN a TYPE bigint;", "alter-type"],
    ["ALTER TABLE t ALTER COLUMN a SET DATA TYPE text;", "alter-type"],
    ["TRUNCATE t;", "truncate"],
    ["DELETE FROM t WHERE a = 1;", "delete"],
    ["UPDATE t SET a = 1;", "update"],
    ["DO $$ BEGIN EXECUTE 'DROP TABLE t'; END $$;", "dynamic-sql"],
    ["DO $$ BEGIN EXECUTE format('DELETE FROM %I', 't'); END $$;", "dynamic-sql"],
    ["DELETE/**/FROM t;", "delete"],
    ["DROP/* x */TABLE t;", "drop"],
    ["DELETE--c\nFROM t;", "delete"],
    ["ALTER TABLE t DISABLE ROW LEVEL SECURITY;", "disable-security"],
    ["ALTER TABLE t NO FORCE ROW LEVEL SECURITY;", "disable-security"],
    ["ALTER TABLE t DISABLE TRIGGER x;", "disable-security"],
    ["ALTER POLICY p ON t USING (true);", "alter-policy"],
    ["REVOKE ALL ON t FROM anon;", "revoke"],
    ["ALTER TABLE t ALTER COLUMN a SET NOT NULL;", "alter-set-not-null"],
    ["ALTER TABLE t ALTER a SET DEFAULT 1;", "alter-set-default"],
    ["CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;", "create-or-replace"],
    ["CREATE OR REPLACE VIEW v AS SELECT 1;", "create-or-replace"],
    ["INSERT INTO t VALUES (1) ON CONFLICT (id) DO UPDATE\n SET a = 2;", "update"],
  ])("flags %s", (sql, rule) => {
    expect(rules(sql)).toContain(rule);
  });

  it("accepts additive statements and ignores comments, strings, FK actions and grants", () => {
    const sql = `
      -- DROP TABLE nope; UPDATE x SET y = 1;
      /* DELETE FROM x */
      CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY, r uuid REFERENCES o(id) ON DELETE CASCADE ON UPDATE SET NULL);
      ALTER TABLE t ADD COLUMN IF NOT EXISTS note text DEFAULT 'DROP me; UPDATE t SET a = 1';
      CREATE POLICY p ON t FOR UPDATE USING (true);
      GRANT UPDATE, DELETE ON t TO service_role;
      INSERT INTO t (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;
      SELECT * FROM t FOR UPDATE;
      CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();
      CREATE TRIGGER trg2 BEFORE INSERT ON t FOR EACH ROW EXECUTE PROCEDURE f();
      ALTER TABLE t ENABLE ROW LEVEL SECURITY;
      ALTER TABLE t ADD COLUMN IF NOT EXISTS z int NOT NULL DEFAULT 0;
      ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (r) REFERENCES o(id) ON DELETE SET DEFAULT;
      GRANT SELECT ON t TO anon;
    `;
    expect(lintSql(sql)).toEqual([]);
    expect(stripSql("a -- c\nb 'x''y' c")).toBe("a  \nb '' c");
  });

  it("exempts UPDATE only inside an allow-update marker", () => {
    const seed = `-- additive-lint: allow-update idempotent seed
INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET a = 1;
-- additive-lint: end-allow-update
UPDATE t SET b = 2;`;
    const found = lintSql(seed);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "update", line: 4 });
    expect(rules("-- additive-lint: allow-update seed\nDELETE FROM t;\n-- additive-lint: end-allow-update")).toEqual(["delete"]);
    expect(rules("-- additive-lint: allow-update seed\nUPDATE t SET a=1;")).toContain("allow-marker");
  });
});

describe("plan SQL gate", () => {
  const entry = (extra: object) => ({ entries: [{ file: "migration-x.sql", runner: "scripts/x.mjs", phase: "predeploy", ...extra }] });

  it("refuses a runner entry that is not marked", () => {
    expect(() => assertPlanSqlGate(entry({}), () => "SELECT 1;")).toThrow(/not marked sql_class/);
  });

  it("re-lints entries marked additive and aborts on findings", () => {
    expect(() => assertPlanSqlGate(entry({ sql_class: "additive" }), () => "CREATE TABLE IF NOT EXISTS t (id int);")).not.toThrow();
    expect(() => assertPlanSqlGate(entry({ sql_class: "additive" }), () => "DROP TABLE t;")).toThrow(/marked additive but .*drop@L1/);
  });

  it("requires an approval reference for founder_approved", () => {
    expect(() => assertPlanSqlGate(entry({ sql_class: "founder_approved" }), () => "DROP TABLE t;")).toThrow(/approval/);
    expect(() => assertPlanSqlGate(entry({ sql_class: "founder_approved", approval: "Founder 2026-10-21 chat" }), () => "DROP TABLE t;")).not.toThrow();
  });

  it("only checks the requested phase and skips manual entries", () => {
    const p = { entries: [{ file: "m.sql", execution: "manual_sql_editor" }, { file: "b.sql", runner: "r", phase: "postdeploy" }] };
    expect(() => assertPlanSqlGate(p, () => "", "predeploy")).not.toThrow();
    expect(() => assertPlanSqlGate(p, () => "", "postdeploy")).toThrow();
  });

  it("the committed plan passes and every runner entry is classified from its real SQL", () => {
    expect(() => assertPlanSqlGate(plan, read)).not.toThrow();
    for (const e of plan.entries.filter((x: { runner?: string }) => x.runner)) {
      const dirty = lintSql(read(e.file)).length > 0;
      // additive must be clean; a clean file must not hide behind grandfathered
      expect(e.sql_class === "additive").toBe(!dirty);
    }
  });

  it("the grandfathered set is frozen: new entries cannot join it", () => {
    const frozen = plan.entries.filter((e: { sql_class?: string }) => e.sql_class === "grandfathered").map((e: { file: string }) => e.file).sort();
    expect(frozen).toHaveLength(18);
    expect(frozen).toContain("migration-booking-meals.sql");
    expect(frozen).toContain("migration-no-show-advice.sql");
  });
});

describe("wiring", () => {
  it("runs the gate in the phase runner and in CI", () => {
    expect(readFileSync(join(root, "scripts/run-production-migration-phase.mjs"), "utf8")).toMatch(/assertPlanSqlGate\(plan,[\s\S]*?phase\)/);
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/run-production-migration-phase\.mjs --check/);
    expect(ci).toMatch(/founder-approved-sql/);
    expect(ci).toMatch(/check-additive-sql\.mjs/);
  });
});

describe("CLI diff selection", () => {
  it("includes renamed SQL files (AMR)", () => {
    expect(readFileSync(join(root, "scripts/check-additive-sql.mjs"), "utf8")).toMatch(/--diff-filter=AMR/);
  });
  it("a founder_approved plan entry (with approval) passes the plan gate despite non-additive SQL", () => {
    const p = { entries: [{ version: "v", file: "f.sql", runner: "r", phase: "postdeploy", sql_class: "founder_approved", approval: "Founder 2026-10-21 chat + label founder-approved-sql" }] };
    expect(() => assertPlanSqlGate(p, () => "DELETE FROM t; DROP TABLE x;")).not.toThrow();
  });
});
