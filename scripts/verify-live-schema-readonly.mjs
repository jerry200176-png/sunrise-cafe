#!/usr/bin/env node
/**
 * Bounded production metadata probe. This script is intentionally SELECT-only:
 * it never loads migration SQL, calls an RPC, or writes any relation.
 */
import postgres from "postgres";

const tableNames = [
  "reservations", "rooms", "menu_categories", "menu_items", "menu_item_options",
  "orders", "order_items", "ops_events", "schema_migrations",
];
const expected = {
  reservations: ["id", "room_id", "start_time", "end_time", "status", "guest_count", "booking_code"],
  rooms: ["id", "branch_id", "name", "capacity"],
  menu_categories: ["id", "branch_id", "name", "is_active"],
  menu_items: ["id", "branch_id", "category_id", "name", "price", "is_available"],
  menu_item_options: ["id", "item_id", "option_group", "option_name", "price_delta"],
  orders: ["id", "branch_id", "table_id", "status", "total_amount"],
  order_items: ["id", "order_id", "menu_item_id", "item_name", "quantity", "unit_price"],
  ops_events: ["id", "ts", "domain", "action", "detail"],
};

function validConnection(value) {
  return Boolean(value && !/\[(ref|region)\]|<[^>]+>/i.test(value));
}

async function main() {
  const connection = process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!validConnection(connection)) throw new Error("Missing a usable read-only Postgres connection URL");
  const sql = postgres(connection, { max: 1, idle_timeout: 10, connect_timeout: 10, ssl: "require", prepare: false });
  try {
    const names = tableNames;
    const columns = await sql.unsafe(`
      SELECT table_name, ordinal_position, column_name, data_type, udt_name,
             is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name, ordinal_position`, [names]);
    const constraints = await sql.unsafe(`
      SELECT child.relname AS table_name, c.conname, c.contype,
             pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class child ON child.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = child.relnamespace
       WHERE n.nspname = 'public' AND child.relname = ANY($1::text[])
       ORDER BY child.relname, c.conname`, [names]);
    const indexes = await sql.unsafe(`
      SELECT tablename AS table_name, indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       ORDER BY tablename, indexname`, [names]);
    const rls = await sql.unsafe(`
      SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`, [names]);
    const policies = await sql.unsafe(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd
        FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       ORDER BY tablename, policyname`, [names]);
    const grants = await sql.unsafe(`
      SELECT table_name, grantee, privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
       ORDER BY table_name, grantee, privilege_type`, [names]);
    const ledger = await sql.unsafe(`
      SELECT version, name, applied_at
        FROM public.schema_migrations
       ORDER BY applied_at`, []);

    const present = new Map();
    for (const column of columns) present.set(`${column.table_name}.${column.column_name}`, true);
    const missing = Object.entries(expected).flatMap(([table, cols]) => cols.filter((column) => !present.has(`${table}.${column}`)).map((column) => `${table}.${column}`));
    const tableSet = new Set(columns.map((column) => column.table_name));
    const missingTables = tableNames.filter((table) => !tableSet.has(table));
    const result = {
      mode: "read-only-postgres-catalog",
      captured_at: new Date().toISOString(),
      parity: missing.length === 0 && missingTables.length === 0 ? "PASS" : "BLOCKED",
      missing_tables: missingTables,
      missing_expected_columns: missing,
      columns, constraints, indexes, rls, policies, grants,
      schema_migrations: ledger,
    };
    console.log(JSON.stringify(result, null, 2));
    if (result.parity !== "PASS") process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
