#!/usr/bin/env node
/**
 * Apply deposit_approved_retry_key columns and index if missing.
 * Probes via REST fetch. DDL requires SUPABASE_DB_URL (or Postgres URL variants).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "../supabase/migration-deposit-approved-retry-key.sql"),
  "utf8"
);

async function columnExists(url, key) {
  const res = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/reservations?select=deposit_approved_retry_key&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const text = await res.text();
  if (res.status === 200) return true;
  if (/deposit_approved_retry_key|42703|does not exist/i.test(text)) return false;
  console.warn("[migrate] probe ambiguous:", res.status, text.slice(0, 200));
  return false;
}

async function applyViaPostgres(connectionString) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 10, ssl: "require" });
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
    process.env.POSTGRES_PRISMA_URL ??
    process.env.DATABASE_URL;

  if (!url || !serviceKey) {
    console.log("Skip: Supabase URL/key unset");
    process.exit(0);
  }

  if (serviceKey.startsWith("<") || serviceKey.length < 40) {
    console.log("Skip: service role key looks like a placeholder");
    process.exit(0);
  }

  if (await columnExists(url, serviceKey)) {
    console.log("deposit_approved_retry_key already exists");
    process.exit(0);
  }

  if (!pgUrl || pgUrl.includes("[region]")) {
    console.warn("deposit_approved_retry_key missing but no valid Postgres URL provided — skipping DDL");
    process.exit(0);
  }

  console.log("Applying migration-deposit-approved-retry-key.sql …");
  try {
    await applyViaPostgres(pgUrl);
    console.log("OK: deposit_approved_retry_key ready");
  } catch (err) {
    console.error("Failed to apply migration:", err?.message || err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Migration script error:", err);
  process.exit(1);
});
