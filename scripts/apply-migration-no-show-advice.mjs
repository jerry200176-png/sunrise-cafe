#!/usr/bin/env node
/** Adds reservations.status 'no_show' (CHECK widened) and the advice_decisions table. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

const VERSION = "20261011-no-show-advice";
const FILE = "migration-no-show-advice.sql";
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../supabase", FILE), "utf8");

export function migrationBody(input) {
  const match = /^(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(input);
  if (!match) throw new Error("No-show advice SQL transaction wrapper changed");
  return match[1];
}

async function hasVersion(sql) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${VERSION} LIMIT 1`;
  return rows.length === 1;
}

export async function applyNoShowAdvice(sql, input = source) {
  if (await hasVersion(sql)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(sql, "already_applied");
  }
  await sql.begin(async (transaction) => transaction.unsafe(migrationBody(input)));
  if (!(await hasVersion(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return verify(sql, "applied");
}

async function verify(sql, status) {
  const table = await sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'advice_decisions'`;
  if (table.length !== 1) throw new Error("advice_decisions table missing");
  const check = await sql`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'public.reservations'::regclass AND conname = 'reservations_status_check'`;
  if (check.length !== 1 || !String(check[0].def).includes("no_show")) throw new Error("reservations_status_check does not allow no_show");
  return { ledger: VERSION, status, advice_decisions: true, no_show_allowed: true };
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyNoShowAdvice(sql) }));
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
