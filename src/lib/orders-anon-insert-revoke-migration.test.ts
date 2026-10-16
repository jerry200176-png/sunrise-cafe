import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath = "supabase/migration-orders-anon-insert-revoke.sql";
const migration = read(migrationPath);
const rollback = read("supabase/rollbacks/orders-anon-insert-revoke.sql");
const planDoc = read("docs/plans/2026-10-15-orders-anon-insert-revoke.md");
const plan = JSON.parse(read("scripts/production-migration-plan.json")) as {
  entries: Array<{ version?: string; file: string; runner?: string; execution?: string; phase?: string }>;
};
const code = (sql: string) => sql.replace(/^--.*$/gm, "");

describe("orders anon INSERT revoke migration (#434, prepared only)", () => {
  it("is registered as manual_sql_editor so the deploy pipeline never applies it", () => {
    const entry = plan.entries.find((item) => item.file === "migration-orders-anon-insert-revoke.sql");
    expect(entry).toEqual({
      version: "20261015-orders-anon-insert-revoke",
      file: "migration-orders-anon-insert-revoke.sql",
      execution: "manual_sql_editor",
    });
    expect(migration).toContain("'20261015-orders-anon-insert-revoke'");
  });

  it("removes only anon/authenticated INSERT on orders and order_items", () => {
    const body = code(migration);
    expect(body).toContain('DROP POLICY IF EXISTS "anon_insert_orders" ON orders;');
    expect(body).toContain('DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;');
    expect(body).toMatch(/REVOKE INSERT ON TABLE orders FROM anon, authenticated;/);
    expect(body).toMatch(/REVOKE INSERT ON TABLE order_items FROM anon, authenticated;/);
    expect(body).not.toMatch(/anon_read_|service_all_|CREATE POLICY|GRANT /i);
    expect(body).not.toMatch(/\b(DELETE FROM|UPDATE |TRUNCATE|DROP TABLE|DROP COLUMN|ALTER COLUMN)\b/i);
  });

  it("has a rollback that restores the booking-meals INSERT policies and grants", () => {
    const meals = read("supabase/migration-booking-meals.sql");
    for (const policy of ["anon_insert_orders", "anon_insert_order_items"]) {
      const create = new RegExp(`CREATE POLICY "${policy}"[^;]*;`);
      expect(rollback.match(create)?.[0]).toBe(meals.match(create)?.[0]);
    }
    expect(rollback).toMatch(/GRANT INSERT ON TABLE orders TO anon, authenticated;/);
    expect(rollback).toMatch(/GRANT INSERT ON TABLE order_items TO anon, authenticated;/);
    expect(code(rollback)).not.toMatch(/\b(UPDATE |TRUNCATE|DROP TABLE)\b/i);
  });

  it("pins the SQL sha256 in the plan doc", () => {
    const sha = createHash("sha256").update(readFileSync(join(root, migrationPath))).digest("hex");
    expect(planDoc).toContain(sha);
  });
});
