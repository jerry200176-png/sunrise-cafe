#!/usr/bin/env node
/**
 * Apply and verify the approved Reservation Preorder migration.
 *
 * This is intentionally a single-migration runner. It does not infer or
 * repair any other migration, and it fails closed when the connection or
 * project identity is not explicit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const VERSION = "20260921-reservation-preorder";
const MIGRATION_FILE = "migration-reservation-preorder.sql";
const SQL = readFileSync(join(scriptDir, "../supabase", MIGRATION_FILE), "utf8");

const REQUIRED_RELATIONS = [
  "reservations",
  "rooms",
  "menu_items",
  "menu_item_options",
  "schema_migrations",
];

const EXPECTED_COLUMNS = {
  menu_items: ["preorder_eligible"],
  reservation_preorders: [
    "id",
    "reservation_id",
    "status",
    "requires_reconfirmation",
    "guest_notes",
    "draft_items",
    "submit_idempotency_key",
    "submitted_at",
    "locked_at",
    "cancelled_at",
    "created_at",
    "updated_at",
  ],
  reservation_preorder_items: [
    "id",
    "preorder_id",
    "source_menu_item_id",
    "item_name_snapshot",
    "unit_price_snapshot",
    "quantity",
    "selected_options_snapshot",
    "special_notes",
    "created_at",
  ],
};

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

export function projectRefFromSupabaseUrl(value) {
  return String(value ?? "").match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] ?? null;
}

export function projectRefFromDbUrl(value) {
  try {
    const url = new URL(value);
    const hostRef = url.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1];
    if (hostRef) return hostRef;
    const userRef = decodeURIComponent(url.username ?? "");
    const poolerRef = userRef.match(/^postgres\.([a-z0-9-]+)$/i)?.[1];
    if (poolerRef) return poolerRef;
    return null;
  } catch {
    return null;
  }
}

async function connect() {
  const connectionString = postgresUrl();
  if (!usableUrl(connectionString)) {
    throw new Error("Missing usable SUPABASE_DB_URL/POSTGRES_URL; migration is fail-closed");
  }
  const apiRef = projectRefFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const dbRef = projectRefFromDbUrl(connectionString);
  if (!apiRef || !dbRef || apiRef !== dbRef) {
    throw new Error("Supabase API and database project references do not match");
  }
  const { default: postgres } = await import("postgres");
  return postgres(connectionString, { max: 1, idle_timeout: 15, ssl: "require" });
}

async function migrationApplied(sql) {
  const rows = await sql`
    SELECT 1 FROM schema_migrations WHERE version = ${VERSION} LIMIT 1
  `;
  return rows.length > 0;
}

async function verify(sql) {
  const relations = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${sql.array([
        ...REQUIRED_RELATIONS,
        "reservation_preorders",
        "reservation_preorder_items",
      ])})
  `;
  const relationSet = new Set(relations.map((row) => row.table_name));
  const missingRelations = [
    ...REQUIRED_RELATIONS,
    "reservation_preorders",
    "reservation_preorder_items",
  ].filter((name) => !relationSet.has(name));
  if (missingRelations.length) {
    throw new Error(`Reservation preorder relations missing: ${missingRelations.join(", ")}`);
  }

  const columns = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(${sql.array(Object.keys(EXPECTED_COLUMNS))})
  `;
  const present = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = Object.entries(EXPECTED_COLUMNS).flatMap(([table, names]) =>
    names.filter((name) => !present.has(`${table}.${name}`)).map((name) => `${table}.${name}`)
  );
  if (missingColumns.length) {
    throw new Error(`Reservation preorder columns missing: ${missingColumns.join(", ")}`);
  }

  const constraints = await sql`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint AS c
    JOIN pg_class AS t ON t.oid = c.conrelid
    JOIN pg_namespace AS n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('reservation_preorders', 'reservation_preorder_items')
      AND c.contype IN ('p', 'u', 'f', 'c')
  `;
  const definitions = constraints.map((row) => row.definition).join("\n");
  for (const required of [
    "UNIQUE (reservation_id)",
    "FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE",
    "FOREIGN KEY (preorder_id) REFERENCES public.reservation_preorders(id) ON DELETE CASCADE",
    "FOREIGN KEY (source_menu_item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL",
  ]) {
    if (!definitions.includes(required)) throw new Error(`Missing constraint: ${required}`);
  }

  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${sql.array([
        "idx_reservation_preorders_status",
        "idx_reservation_preorders_reconfirmation",
        "idx_reservation_preorder_items_preorder",
        "idx_reservation_preorder_items_source_item",
      ])})
  `;
  const indexSet = new Set(indexes.map((row) => row.indexname));
  if (indexSet.size !== 4) throw new Error("Reservation preorder indexes are incomplete");

  const functionRows = await sql`
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = 'public.submit_reservation_preorder(uuid,text,jsonb,text)'
  `;
  if (functionRows.length !== 1) throw new Error("Submit RPC is missing");

  const triggerRows = await sql`
    SELECT 1
    FROM pg_trigger AS tr
    JOIN pg_class AS t ON t.oid = tr.tgrelid
    JOIN pg_namespace AS n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'reservations'
      AND tr.tgname = 'trg_reservation_preorder_lifecycle'
      AND NOT tr.tgisinternal
  `;
  if (triggerRows.length !== 1) throw new Error("Reservation lifecycle trigger is missing");

  const rlsRows = await sql`
    SELECT c.relname, c.relrowsecurity
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('reservation_preorders', 'reservation_preorder_items')
  `;
  if (rlsRows.length !== 2 || rlsRows.some((row) => row.relrowsecurity !== true)) {
    throw new Error("Reservation preorder RLS is not enabled on both tables");
  }

  const policies = await sql`
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('reservation_preorders', 'reservation_preorder_items')
  `;
  if (policies.length !== 0) throw new Error("Unexpected public preorder RLS policy exists");

  const privileges = await sql`
    SELECT
      has_function_privilege('public', 'public.submit_reservation_preorder(uuid,text,jsonb,text)', 'EXECUTE') AS public_execute,
      has_function_privilege('anon', 'public.submit_reservation_preorder(uuid,text,jsonb,text)', 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', 'public.submit_reservation_preorder(uuid,text,jsonb,text)', 'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role', 'public.submit_reservation_preorder(uuid,text,jsonb,text)', 'EXECUTE') AS service_execute
  `;
  const privilege = privileges[0];
  if (privilege.public_execute || privilege.anon_execute || privilege.authenticated_execute || !privilege.service_execute) {
    throw new Error("Submit RPC privilege boundary is invalid");
  }

  if (!(await migrationApplied(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return {
    relations: 7,
    columns: Object.values(EXPECTED_COLUMNS).reduce((count, names) => count + names.length, 0),
    indexes: indexSet.size,
    submit_rpc: true,
    lifecycle_trigger: true,
    rls: "enabled_no_public_policies",
    rpc_privilege: "service_role_only",
    ledger: VERSION,
  };
}

async function main() {
  const sql = await connect();
  try {
    if (await migrationApplied(sql)) {
      console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    } else {
      console.log(JSON.stringify({ migration: VERSION, status: "applying", file: MIGRATION_FILE }));
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
    process.exit(1);
  });
}
