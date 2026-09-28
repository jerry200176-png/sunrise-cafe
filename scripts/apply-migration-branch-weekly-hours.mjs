#!/usr/bin/env node
/** Adds the nullable branches.weekly_hours column (per-weekday opening hours). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

const VERSION = "20260928-branch-weekly-hours";
const FILE = "migration-branch-weekly-hours.sql";
const COLUMNS = ["weekly_hours"];
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../supabase", FILE), "utf8");

export function migrationBody(input) {
  const match = /^(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(input);
  if (!match) throw new Error("Branch weekly hours SQL transaction wrapper changed");
  return match[1];
}

async function hasVersion(sql) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${VERSION} LIMIT 1`;
  return rows.length === 1;
}

export async function applyBranchWeeklyHours(sql, input = source) {
  if (await hasVersion(sql)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(sql, "already_applied");
  }
  await sql.begin(async (transaction) => transaction.unsafe(migrationBody(input)));
  if (!(await hasVersion(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return verify(sql, "applied");
}

async function verify(sql, status) {
  const rows = await sql`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'branches'
       AND column_name IN ('weekly_hours')
     ORDER BY column_name
  `;
  const found = rows.map((row) => row.column_name);
  if (found.join(",") !== COLUMNS.join(",")) {
    throw new Error(`branches weekly_hours column missing: expected ${COLUMNS.join(",")}, found ${found.join(",")}`);
  }
  if (rows.some((row) => row.is_nullable !== "YES")) throw new Error("branches weekly_hours column must stay nullable");
  return { ledger: VERSION, status, columns: found };
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyBranchWeeklyHours(sql) }));
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
