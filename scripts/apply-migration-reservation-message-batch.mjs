#!/usr/bin/env node
/** Apply the nullable batch_id audit column when it is missing. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(scriptDir, "../supabase/migration-reservation-message-batch-id.sql"),
  "utf8"
);

function restBase() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
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

function hasUsableServiceKey(key) {
  return key.length >= 40 && !key.startsWith("<");
}

function hasUsablePostgresUrl(url) {
  return Boolean(url) && !/[\[<](?:region|ref|YOUR|PASSWORD)/i.test(url);
}

async function batchIdColumnExists() {
  const base = restBase();
  const key = serviceKey();
  if (!base || !hasUsableServiceKey(key)) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(
    `${base}/rest/v1/reservation_message_actions?select=batch_id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const body = await response.text();
  if (response.status === 200) return true;
  if (response.status === 400 && /batch_id|column/i.test(body)) return false;
  if (response.status === 404 || /PGRST205|does not exist|42P01/i.test(body)) {
    throw new Error("reservation_message_actions is missing; apply its base migration first");
  }
  throw new Error(`batch_id probe HTTP ${response.status}: ${body.slice(0, 300)}`);
}

async function applyMigration(connectionString) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 15, ssl: "require" });
  try {
    await sql.unsafe(SQL);
  } finally {
    await sql.end({ timeout: 10 });
  }
}

async function waitForColumn(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await batchIdColumnExists()) return true;
    if (attempt < maxAttempts) {
      const delayMs = attempt * 1000;
      console.log(`PostgREST schema cache not ready; retrying in ${delayMs}ms …`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

async function main() {
  if (await batchIdColumnExists()) {
    console.log("OK: reservation_message_actions.batch_id already exists");
    return;
  }

  const connectionString = postgresUrl();
  if (!hasUsablePostgresUrl(connectionString)) {
    throw new Error("batch_id is missing and no usable SUPABASE_DB_URL/Postgres URL is configured");
  }

  console.log("Applying migration-reservation-message-batch-id.sql …");
  await applyMigration(connectionString);
  if (!(await waitForColumn())) throw new Error("Migration ran but batch_id is still missing");
  console.log("OK: reservation_message_actions.batch_id ready");
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
