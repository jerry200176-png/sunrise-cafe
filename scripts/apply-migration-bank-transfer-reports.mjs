#!/usr/bin/env node
/**
 * Apply the bank-transfer reporting migration through the explicit production
 * migration path. This script never infers payment state from customer data.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const VERSION = "20260914-bank-transfer-reports";
const SQL = readFileSync(
  join(scriptDir, "../supabase/migration-bank-transfer-reports.sql"),
  "utf8"
);
const EXPECTED_COLUMNS = [
  "reported_account_last_five",
  "reported_amount",
  "reported_at",
  "created_by",
  "updated_at",
  "updated_by",
  "reviewed_by",
];
const EXPECTED_FUNCTIONS = [
  "record_bank_transfer_report(uuid,text,numeric)",
  "confirm_bank_transfer_payment(uuid,text,text)",
];

async function repairRoleSpecificRpcPrivileges(sql) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      "REVOKE ALL ON FUNCTION record_bank_transfer_report(UUID, TEXT, NUMERIC) FROM anon, authenticated;"
    );
    await transaction.unsafe(
      "REVOKE ALL ON FUNCTION confirm_bank_transfer_payment(UUID, TEXT, TEXT) FROM anon, authenticated;"
    );
    await transaction.unsafe(
      "GRANT EXECUTE ON FUNCTION record_bank_transfer_report(UUID, TEXT, NUMERIC) TO service_role;"
    );
    await transaction.unsafe(
      "GRANT EXECUTE ON FUNCTION confirm_bank_transfer_payment(UUID, TEXT, TEXT) TO service_role;"
    );
  });
}

function postgresUrl() {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.DATABASE_URL ??
    ""
  );
}

function usableUrl(value) {
  return Boolean(value) && !/[\[<](?:region|ref|YOUR|PASSWORD)/i.test(value);
}

function connectionOptions(connectionString) {
  const local = /(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(
    connectionString
  );
  return { max: 1, idle_timeout: 15, ...(local ? { ssl: false } : { ssl: "require" }) };
}

async function connect() {
  const connectionString = postgresUrl();
  if (!usableUrl(connectionString)) {
    throw new Error(
      "Missing usable SUPABASE_DB_URL/POSTGRES_URL; explicit migration execution is fail-closed"
    );
  }
  const { default: postgres } = await import("postgres");
  return postgres(connectionString, connectionOptions(connectionString));
}

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

export async function verify(sql) {
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

  const privileges = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = 'public.record_bank_transfer_report(uuid,text,numeric)'::regprocedure
          AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) AS public_report,
      EXISTS (
        SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = 'public.confirm_bank_transfer_payment(uuid,text,text)'::regprocedure
          AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) AS public_confirm,
      has_function_privilege('anon', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS anon_report,
      has_function_privilege('anon', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS anon_confirm,
      has_function_privilege('authenticated', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS authenticated_report,
      has_function_privilege('authenticated', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS authenticated_confirm,
      has_function_privilege('service_role', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS service_report,
      has_function_privilege('service_role', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS service_confirm
  `;
  const privilege = privileges[0];
  const functionAcl = await sql`
    SELECT
      p.oid::regprocedure::text AS signature,
      owner.rolname AS owner,
      COALESCE(array_to_string(p.proacl, ','), '') AS acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles owner ON owner.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = ANY(${sql.array(EXPECTED_FUNCTIONS)})
    ORDER BY signature
  `;
  console.log(
    JSON.stringify({
      migration: VERSION,
      privilege_probe: privilege,
      function_acl: functionAcl,
    })
  );
  const denied = ["public_report", "public_confirm", "anon_report", "anon_confirm",
    "authenticated_report", "authenticated_confirm"];
  const allowed = ["service_report", "service_confirm"];
  if (privileges.length !== 1 || !privilege ||
      denied.some((name) => privilege[name] !== false) ||
      allowed.some((name) => privilege[name] !== true)) {
    throw new Error("Bank-transfer RPC permission verification failed");
  }
  if (!(await migrationApplied(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return { columns: EXPECTED_COLUMNS, indexes: 2, functions: EXPECTED_FUNCTIONS, privileges: "service_role_only" };
}

async function main() {
  const sql = await connect();
  try {
    const applied = await migrationApplied(sql);
    if (applied) {
      console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
      await repairRoleSpecificRpcPrivileges(sql);
      console.log(JSON.stringify({ migration: VERSION, status: "role_privileges_repaired" }));
    } else {
      console.log(JSON.stringify({ migration: VERSION, status: "applying", plan: "explicit" }));
      await sql.begin(async (transaction) => {
        await transaction.unsafe(SQL);
      });
      console.log(JSON.stringify({ migration: VERSION, status: "applied" }));
    }
    console.log(JSON.stringify({ migration: VERSION, verification: await verify(sql) }));
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
