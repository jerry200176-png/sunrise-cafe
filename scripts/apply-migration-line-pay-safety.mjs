#!/usr/bin/env node
/** Apply the LINE Pay safety/outbox schema and verify its public probes. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(scriptDir, "../supabase/migration-line-pay-safety.sql"), "utf8");

function restBase() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
}
function serviceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; }
function postgresUrl() {
  return process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL ?? "";
}
function usableKey(value) { return value.length >= 40 && !value.startsWith("<"); }
function usablePostgresUrl(value) { return Boolean(value) && !/[\[<](?:region|ref|YOUR|PASSWORD)/i.test(value); }

async function probe() {
  const base = restBase();
  const key = serviceKey();
  if (!base || !usableKey(key)) throw new Error("Missing Supabase URL or service key");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const [payments, outbox] = await Promise.all([
    fetch(`${base}/rest/v1/line_pay_payments?select=id,confirm_attempt_id&limit=1`, { headers }),
    fetch(`${base}/rest/v1/line_pay_notification_outbox?select=id,status&limit=1`, { headers }),
  ]);
  if (!payments.ok || !outbox.ok) throw new Error("LINE Pay safety tables are not ready");
}

async function main() {
  try {
    await probe();
    console.log("OK: linepay safety schema already exists");
    return;
  } catch {
    // Keep URLs, keys, and provider responses out of logs.
  }
  const connectionString = postgresUrl();
  if (!usablePostgresUrl(connectionString)) throw new Error("Safety schema is missing and no usable Postgres URL is configured");
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 15, ssl: "require" });
  try { await sql.unsafe(SQL); } finally { await sql.end({ timeout: 10 }); }
  await probe();
  console.log("OK: linepay safety schema ready");
}

main().catch((error) => {
  console.error(error?.message ?? "LINE Pay safety migration failed");
  process.exit(1);
});
