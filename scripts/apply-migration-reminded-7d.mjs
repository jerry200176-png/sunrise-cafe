#!/usr/bin/env node
/**
 * Apply is_reminded_7d column if missing.
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or POSTGRES_URL / SUPABASE_DB_URL)
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/apply-migration-reminded-7d.mjs
 * Or with direct Postgres:
 *   SUPABASE_DB_URL=postgresql://postgres:...@db....supabase.co:5432/postgres node scripts/apply-migration-reminded-7d.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "../supabase/migration-reservations-is-reminded-7d.sql"),
  "utf8"
);

async function probeColumn(url, key) {
  const db = createClient(url, key);
  const { error } = await db.from("reservations").select("is_reminded_7d").limit(1);
  if (!error) return { exists: true };
  const msg = error.message ?? String(error);
  if (/is_reminded_7d/i.test(msg) && /does not exist|42703/i.test(msg)) {
    return { exists: false, message: msg };
  }
  throw new Error(msg);
}

async function applyViaPostgres(connectionString) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 5 });
  try {
    await sql.unsafe(SQL);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pgUrl =
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;

  if (!url && !pgUrl) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_URL");
    process.exit(1);
  }

  if (url && serviceKey) {
    const probe = await probeColumn(url, serviceKey);
    if (probe.exists) {
      console.log("OK: reservations.is_reminded_7d already exists");
      return;
    }
    console.log("Column missing:", probe.message);
  }

  if (!pgUrl) {
    console.error(
      "Column missing but no Postgres URL. Set SUPABASE_DB_URL (Dashboard → Settings → Database → Connection string URI)."
    );
    process.exit(1);
  }

  console.log("Applying migration via Postgres...");
  await applyViaPostgres(pgUrl);

  if (url && serviceKey) {
    const after = await probeColumn(url, serviceKey);
    if (!after.exists) throw new Error("Migration ran but column still missing");
  }
  console.log("OK: migration applied");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
