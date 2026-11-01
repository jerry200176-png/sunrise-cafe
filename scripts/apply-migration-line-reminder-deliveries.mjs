#!/usr/bin/env node
/** Verify the existing migration-line-reminder-deliveries.sql contract without executing or repairing it. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
export const CATALOG_SQL = readFileSync(join(dir, "sql/verify-line-reminder-readiness.sql"), "utf8");
const CHECKS = ["table_present", "columns_present", "reservation_columns_present", "id_primary", "reservation_foreign_key",
  "claim_unique", "function_shape", "service_execute", "service_table_access", "no_guest_execute"];

/** Return a reference only for supported, unambiguous Supabase endpoints. */
export function projectReferences(apiUrl, dbUrl) {
  try {
    const api = new URL(apiUrl);
    const db = new URL(dbUrl);
    if (api.protocol !== "https:" || api.username || api.password || api.port ||
        !["", "/"].includes(api.pathname) || api.search || api.hash ||
        !["postgres:", "postgresql:"].includes(db.protocol) || db.hash) return null;
    const apiRef = api.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1]?.toLowerCase();
    const directRef = db.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1]?.toLowerCase();
    const poolerHost = /^[a-z0-9.-]+\.pooler\.supabase\.com$/i.test(db.hostname);
    const poolerRef = poolerHost
      ? decodeURIComponent(db.username).match(/^postgres\.([a-z0-9-]+)$/i)?.[1]?.toLowerCase()
      : undefined;
    const dbRef = directRef || poolerRef;
    return apiRef && dbRef && apiRef === dbRef ? apiRef : null;
  } catch {
    return null;
  }
}

export async function verifyCatalog(sql) {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    // No user-defined search-path function should shadow catalog helpers.
    await tx.unsafe("SET LOCAL search_path = pg_catalog");
    const rows = await tx.unsafe(CATALOG_SQL);
    if (rows.length !== 1 || CHECKS.some((key) => rows[0][key] !== true)) {
      throw new Error("LINE reminder catalog or role contract is incomplete; manual review required");
    }

  });
}

export class UnverifiedRpcCache extends Error {}

export async function verifyReadiness(sql) {
  await verifyCatalog(sql);
  // The migration ledger is also unknown: reading a user relation may execute
  // views, rules, or row-level security policies even inside a read-only transaction.
  // PostgREST 12 cannot introspect a required-argument RPC via OPTIONS.
  // Even sound catalog evidence does not prove the exposed cache is current.
  throw new UnverifiedRpcCache("LINE reminder RPC schema cache is unverified; release remains blocked");
}

async function main() {
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const db = process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL ?? "";
  if (!projectReferences(api, db) || key.length < 40 || key.startsWith("<") || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("LINE reminder verifier configuration is incomplete or project identity is ambiguous");
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(db, { max: 1, connect_timeout: 10, idle_timeout: 10,
    ssl: { rejectUnauthorized: true }, onnotice: () => {} });
  try {
    await verifyReadiness(sql);
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // Never log database URLs, service keys, response bodies or untrusted errors.
    console.error(error instanceof UnverifiedRpcCache
      ? "LINE reminder RPC schema cache is unverified; release remains blocked"
      : "LINE reminder verification failed; review project identity, catalog and permissions");
    process.exitCode = 1;
  });
}
