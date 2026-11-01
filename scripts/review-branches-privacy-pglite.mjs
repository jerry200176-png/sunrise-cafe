/** Synthetic, in-memory PostgreSQL ACL/RLS check; never connects to a server. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const prefix = process.env.PGLITE_PREFIX;
if (!prefix) throw new Error("Set PGLITE_PREFIX to an isolated install of @electric-sql/pglite@0.5.14");
const requireFromPrefix = createRequire(resolve(prefix, "package.json"));
const { PGlite } = requireFromPrefix("@electric-sql/pglite");
const db = new PGlite();

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE branches (
      id text primary key, name text, address text, phone text, open_time text, close_time text,
      closed_dates jsonb, display_name text, rental_notes jsonb, deposit_info text,
      archived_at timestamptz, line_group_id text, payment_info text, line_pay_url text,
      future_internal text
    );
    INSERT INTO branches (id,name,line_group_id,payment_info,line_pay_url,future_internal)
      VALUES ('synthetic','Example','synthetic-group','synthetic-payment','https://example.invalid','synthetic');
    ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
    CREATE POLICY anon_select ON branches FOR SELECT TO anon USING (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON branches TO anon;
    GRANT SELECT ON branches TO authenticated, service_role;
  `);
  await db.exec(`
    REVOKE SELECT ON TABLE branches FROM anon;
    GRANT SELECT (id,name,address,phone,open_time,close_time,closed_dates,display_name,
      rental_notes,deposit_info,archived_at) ON branches TO anon;
  `);
  const check = await db.query(`SELECT
    has_column_privilege('anon','branches','name','SELECT') AS public_read,
    has_column_privilege('anon','branches','line_group_id','SELECT') AS private_line,
    has_column_privilege('anon','branches','payment_info','SELECT') AS private_payment,
    has_column_privilege('anon','branches','line_pay_url','SELECT') AS private_pay_url,
    has_column_privilege('anon','branches','future_internal','SELECT') AS future_read,
    has_table_privilege('authenticated','branches','SELECT') AS authenticated_unchanged`);
  assert.deepEqual(check.rows[0], { public_read: true, private_line: false, private_payment: false,
    private_pay_url: false, future_read: false, authenticated_unchanged: true });
  await db.exec("SET ROLE anon");
  assert.equal((await db.query("SELECT id, name FROM branches WHERE archived_at IS NULL")).rows.length, 1);
  for (const sql of ["SELECT line_group_id FROM branches", "SELECT payment_info FROM branches", "SELECT * FROM branches"]) {
    await assert.rejects(() => db.query(sql), (error) => error.code === "42501");
  }
  assert.equal((await db.query("UPDATE branches SET name='should-not-write' WHERE id='synthetic' RETURNING id")).rows.length, 0);
  await assert.rejects(() => db.query("INSERT INTO branches (id) VALUES ('should-not-write')"), (error) => error.code === "42501");
  await db.exec("RESET ROLE; SET ROLE service_role");
  assert.equal((await db.query("SELECT line_group_id FROM branches WHERE id='synthetic'")).rows[0].line_group_id, "synthetic-group");
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT name FROM branches WHERE id='synthetic'")).rows[0].name, "Example");
  console.log("Synthetic in-memory column ACL/RLS checks passed; no PostgREST or production database was used.");
} finally {
  await db.close();
}
