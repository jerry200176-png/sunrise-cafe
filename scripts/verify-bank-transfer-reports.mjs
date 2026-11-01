#!/usr/bin/env node
/**
 * Verify the previously applied migration-bank-transfer-reports.sql without executing it
 * or changing data or ACLs. A missing ledger entry requires a separate reviewed procedure.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BANK_TRANSFER_FUNCTIONS, verifyBankTransferAcl } from "./lib/bank-transfer-acl.mjs";
import { connectOpsPostgres } from "./lib/ops-postgres.mjs";

const VERSION = "20260914-bank-transfer-reports";
const EXPECTED_COLUMNS = [
  "reported_account_last_five",
  "reported_amount",
  "reported_at",
  "created_by",
  "updated_at",
  "updated_by",
  "reviewed_by",
];
const EXPECTED_FUNCTIONS = BANK_TRANSFER_FUNCTIONS;

async function relationExists(sql, relation) {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${relation}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function migrationApplied(sql) {
  if (!(await relationExists(sql, "schema_migrations"))) return false;
  const rows = await sql`
    SELECT 1 FROM schema_migrations WHERE version = ${VERSION} LIMIT 1
  `;
  return rows.length > 0;
}

async function verify(sql) {
  const missingRelations = [];
  for (const relation of ["payment_events", "reservations", "ops_events", "schema_migrations"]) {
    if (!(await relationExists(sql, relation))) missingRelations.push(relation);
  }
  if (missingRelations.length) {
    throw new Error(`Required relations missing: ${missingRelations.join(", ")}`);
  }

  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_events'
      AND column_name = ANY(${sql.array(EXPECTED_COLUMNS)})
  `;
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const missingColumns = EXPECTED_COLUMNS.filter((name) => !presentColumns.has(name));
  if (missingColumns.length) {
    throw new Error(`Bank-transfer columns missing: ${missingColumns.join(", ")}`);
  }

  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('idx_payment_events_one_pending_bank_transfer', 'idx_payment_events_bank_transfer_queue')
  `;
  if (indexes.length !== 2) throw new Error("Bank-transfer indexes are incomplete");

  const functions = await sql`
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.oid::regprocedure::text = ANY(${sql.array(EXPECTED_FUNCTIONS)})
  `;
  const presentFunctions = new Set(functions.map((row) => row.signature));
  const missingFunctions = EXPECTED_FUNCTIONS.filter((name) => !presentFunctions.has(name));
  if (missingFunctions.length) {
    throw new Error(`Bank-transfer functions missing: ${missingFunctions.join(", ")}`);
  }

  const acl = await verifyBankTransferAcl(sql);
  console.log(JSON.stringify({ migration: VERSION, ...acl }));
  if (!(await migrationApplied(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return {
    columns: EXPECTED_COLUMNS,
    indexes: 2,
    functions: EXPECTED_FUNCTIONS,
    privileges: "checked_roles_match_policy",
    checked_roles: ["PUBLIC", "anon", "authenticated", "service_role"],
  };
}

export async function runBankTransferMigration(sql) {
  const verification = await sql.begin("isolation level repeatable read read only", async (transaction) => {
    if (!(await migrationApplied(transaction))) {
      throw new Error(`${VERSION} missing from schema_migrations; automatic bootstrap is disabled`);
    }
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(transaction);
  });
  console.log(JSON.stringify({ migration: VERSION, verification }));
}

async function main() {
  const sql = await connectOpsPostgres();
  try { await runBankTransferMigration(sql); }
  finally { await sql.end({ timeout: 10 }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
