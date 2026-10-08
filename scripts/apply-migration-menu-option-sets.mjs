#!/usr/bin/env node
/** Adds menu option sets (選項組), the DB-side selection check, and merges existing per-item options into sets. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

const VERSION = "20261009-menu-option-sets";
const PREREQUISITE = "20260924-booking-meals";
const FILE = "migration-menu-option-sets.sql";
const TABLES = ["menu_option_set_categories", "menu_option_set_items", "menu_option_set_options", "menu_option_sets"];
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../supabase", FILE), "utf8");

export function migrationBody(input) {
  const match = /^(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(input);
  if (!match) throw new Error("Menu option sets SQL transaction wrapper changed");
  return match[1];
}

async function hasVersion(sql, version) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${version} LIMIT 1`;
  return rows.length === 1;
}

export async function applyMenuOptionSets(sql, input = source) {
  if (await hasVersion(sql, VERSION)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(sql, "already_applied");
  }
  if (!(await hasVersion(sql, PREREQUISITE))) throw new Error(`Prerequisite migration missing: ${PREREQUISITE}`);
  await sql.begin(async (transaction) => transaction.unsafe(migrationBody(input)));
  if (!(await hasVersion(sql, VERSION))) throw new Error(`${VERSION} missing from schema_migrations`);
  return verify(sql, "applied");
}

async function verify(sql, status) {
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY(${sql.array(TABLES)}) ORDER BY table_name`;
  if (tables.map((row) => row.table_name).join(",") !== TABLES.join(",")) {
    throw new Error("menu option set tables missing");
  }
  const columns = await sql`
    SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'menu_item_options'
       AND column_name IN ('set_id', 'set_option_id') ORDER BY column_name`;
  if (columns.length !== 2 || columns.some((row) => row.is_nullable !== "YES")) {
    throw new Error("menu_item_options set_id/set_option_id columns missing or not nullable");
  }
  const fn = await sql`SELECT 1 FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'assert_menu_item_option_selection'`;
  if (fn.length !== 1) throw new Error("assert_menu_item_option_selection function missing");
  const stale = await sql`SELECT count(*)::int AS n FROM menu_item_options WHERE set_id IS NULL`;
  return { ledger: VERSION, status, tables: TABLES.length, unmerged_legacy_option_rows: stale[0].n };
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyMenuOptionSets(sql) }));
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
