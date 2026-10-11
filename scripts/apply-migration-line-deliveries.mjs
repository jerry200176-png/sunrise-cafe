#!/usr/bin/env node
/** Creates the line_deliveries "send once" ledger and its claim function. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

const VERSION = "20261008-line-deliveries";
const FILE = "migration-line-deliveries.sql";
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../supabase", FILE), "utf8");

export function migrationBody(input) {
  const match = /^(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(input);
  if (!match) throw new Error("line_deliveries SQL transaction wrapper changed");
  return match[1];
}

async function hasVersion(sql) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${VERSION} LIMIT 1`;
  return rows.length === 1;
}

export async function applyLineDeliveries(sql, input = source) {
  if (await hasVersion(sql)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(sql, "already_applied");
  }
  await sql.begin(async (transaction) => transaction.unsafe(migrationBody(input)));
  if (!(await hasVersion(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return verify(sql, "applied");
}

async function verify(sql, status) {
  const tables = await sql`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'line_deliveries'
  `;
  if (tables.length !== 1) throw new Error("line_deliveries table missing");
  const fns = await sql`
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'claim_line_delivery'
  `;
  if (fns.length < 1) throw new Error("claim_line_delivery function missing");
  return { ledger: VERSION, status, table: "line_deliveries" };
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyLineDeliveries(sql) }));
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
