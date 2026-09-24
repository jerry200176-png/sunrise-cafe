#!/usr/bin/env node
/** One-time seed for existing available menu items; later staff choices stay intact. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

const VERSION = "20260924-preorder-menu-seed";
const PREREQUISITE = "20260924-booking-meals";
const FILE = "migration-preorder-menu-seed.sql";
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../supabase", FILE), "utf8");

async function hasVersion(sql, version) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${version} LIMIT 1`;
  return rows.length === 1;
}

export function migrationBody(input) {
  const match = /^(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(input);
  if (!match) throw new Error("Preorder menu seed SQL transaction wrapper changed");
  return match[1];
}

export async function applyPreorderMenuSeed(sql, input = source) {
  if (!(await hasVersion(sql, PREREQUISITE))) {
    throw new Error(`Prerequisite migration missing: ${PREREQUISITE}`);
  }
  if (await hasVersion(sql, VERSION)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(sql, "already_applied");
  }
  await sql.begin(async (transaction) => transaction.unsafe(migrationBody(input)));
  if (!(await hasVersion(sql, VERSION))) throw new Error(`${VERSION} missing from schema_migrations`);
  return verify(sql, "applied");
}

async function verify(sql, status) {
  const counts = await sql`
    SELECT count(*) FILTER (WHERE is_available = true) AS available,
           count(*) FILTER (WHERE is_available = true AND preorder_eligible = true) AS eligible
      FROM menu_items
  `;
  const recovery = await sql`
    SELECT count(*) AS rows,
           has_table_privilege('anon', 'public.preorder_menu_seed_changes', 'SELECT') AS anon_read,
           has_table_privilege('authenticated', 'public.preorder_menu_seed_changes', 'SELECT') AS user_read
      FROM preorder_menu_seed_changes
  `;
  const result = {
    ledger: VERSION, status,
    available: Number(counts[0].available), eligible: Number(counts[0].eligible),
    recovery_rows: Number(recovery[0].rows),
  };
  if (recovery[0].anon_read || recovery[0].user_read) throw new Error("Preorder menu seed recovery record is publicly readable");
  if (status === "applied" && result.available > 0 && result.eligible === 0) {
    throw new Error("No available menu item became preorder eligible");
  }
  return result;
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyPreorderMenuSeed(sql) }));
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
