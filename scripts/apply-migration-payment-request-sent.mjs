#!/usr/bin/env node
/**
 * Apply payment_request_sent_at column if missing.
 * Probes via REST fetch. DDL requires SUPABASE_DB_URL (or Postgres URL variants).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "../supabase/migration-reservations-payment-request-sent.sql"),
  "utf8"
);

async function columnExists(url, key) {
  const res = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/reservations?select=payment_request_sent_at&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const text = await res.text();
  if (res.status === 200) return true;
  if (/payment_request_sent_at|42703|does not exist/i.test(text)) return false;
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
    console.log("payment_request_sent_at already exists");
    process.exit(0);
  }

  if (!pgUrl || pgUrl.includes("[region]") || pgUrl.includes("[ref]")) {
    console.error("Column missing and SUPABASE_DB_URL unset — cannot apply DDL");
    process.exit(1);
  }

  console.log("Applying migration-reservations-payment-request-sent.sql …");
  await applyViaPostgres(pgUrl);

  if (!(await columnExists(url, serviceKey))) {
    console.error("Apply finished but column probe still failing");
    process.exit(1);
  }
  console.log("OK: payment_request_sent_at ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
