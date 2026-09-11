#!/usr/bin/env node
/** Apply the automatic guest LINE notification idempotency ledger when missing. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(scriptDir, "../supabase/migration-line-guest-notification-deliveries.sql"),
  "utf8"
);
const LIFECYCLE_VERSION = "20260903-line-guest-notification-lifecycle";
const LIFECYCLE_SQL = readFileSync(
  join(scriptDir, "../supabase/migration-line-guest-notification-lifecycle.sql"),
  "utf8"
);
const DEPOSIT_REQUEST_GUARD_VERSION = "20260911-line-guest-deposit-request-unpaid-guard";
const DEPOSIT_REQUEST_GUARD_SQL = readFileSync(
  join(scriptDir, "../supabase/migration-line-guest-notification-deposit-request-guard.sql"),
  "utf8"
);
const DEPOSIT_REQUEST_RETRY_KEY_VERSION = "20260911-line-guest-deposit-request-retry-key";
const DEPOSIT_REQUEST_RETRY_KEY_SQL = readFileSync(
  join(scriptDir, "../supabase/migration-line-guest-notification-deposit-request-retry-key.sql"),
  "utf8"
);

function restBase() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(
    /\/$/,
    ""
  );
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

async function tableExists() {
  const base = restBase();
  const key = serviceKey();
  if (!base || !hasUsableServiceKey(key)) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(
    `${base}/rest/v1/line_guest_notification_deliveries?select=id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const body = await response.text();
  if (response.status === 200) return true;
  if (response.status === 404 || /PGRST205|does not exist|42P01/i.test(body)) return false;
  throw new Error(
    `line_guest_notification_deliveries probe HTTP ${response.status}: ${body.slice(0, 300)}`
  );
}

async function applyMigration(connectionString, sqlText) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 15, ssl: "require" });
  try {
    await sql.unsafe(sqlText);
  } finally {
    await sql.end({ timeout: 10 });
  }
}

async function migrationApplied(version) {
  const base = restBase();
  const key = serviceKey();
  const response = await fetch(
    `${base}/rest/v1/schema_migrations?select=version&version=eq.${encodeURIComponent(version)}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`schema_migrations probe HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body).some((row) => row.version === version);
}

async function waitForTable(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await tableExists()) return true;
    if (attempt < maxAttempts) {
      const delayMs = attempt * 1000;
      console.log(`PostgREST schema cache not ready; retrying in ${delayMs}ms …`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

async function main() {
  const connectionString = postgresUrl();
  if (!(await tableExists())) {
    if (!hasUsablePostgresUrl(connectionString)) {
      throw new Error(
        "line_guest_notification_deliveries is missing and no usable SUPABASE_DB_URL/Postgres URL is configured"
      );
    }
    console.log("Applying migration-line-guest-notification-deliveries.sql …");
    await applyMigration(connectionString, SQL);
    if (!(await waitForTable())) {
      throw new Error("Migration ran but line_guest_notification_deliveries is still missing");
    }
    console.log("OK: line_guest_notification_deliveries ready");
  }

  if (await migrationApplied(LIFECYCLE_VERSION)) {
    console.log(`OK: ${LIFECYCLE_VERSION} already applied`);
  } else {
    if (!hasUsablePostgresUrl(connectionString)) {
      throw new Error(`${LIFECYCLE_VERSION} is missing and no usable SUPABASE_DB_URL/Postgres URL is configured`);
    }
    console.log("Applying migration-line-guest-notification-lifecycle.sql …");
    await applyMigration(connectionString, LIFECYCLE_SQL);
    if (!(await migrationApplied(LIFECYCLE_VERSION))) {
      throw new Error(`${LIFECYCLE_VERSION} ran but ledger verification failed`);
    }
    console.log(`OK: ${LIFECYCLE_VERSION} ready`);
  }

  if (await migrationApplied(DEPOSIT_REQUEST_GUARD_VERSION)) {
    console.log(`OK: ${DEPOSIT_REQUEST_GUARD_VERSION} already applied`);
  } else {
    if (!hasUsablePostgresUrl(connectionString)) {
      throw new Error(
        `${DEPOSIT_REQUEST_GUARD_VERSION} is missing and no usable SUPABASE_DB_URL/Postgres URL is configured`
      );
    }
    console.log("Applying migration-line-guest-notification-deposit-request-guard.sql …");
    await applyMigration(connectionString, DEPOSIT_REQUEST_GUARD_SQL);
    if (!(await migrationApplied(DEPOSIT_REQUEST_GUARD_VERSION))) {
      throw new Error(`${DEPOSIT_REQUEST_GUARD_VERSION} ran but ledger verification failed`);
    }
    console.log(`OK: ${DEPOSIT_REQUEST_GUARD_VERSION} ready`);
  }

  if (await migrationApplied(DEPOSIT_REQUEST_RETRY_KEY_VERSION)) {
    console.log(`OK: ${DEPOSIT_REQUEST_RETRY_KEY_VERSION} already applied`);
    return;
  }
  if (!hasUsablePostgresUrl(connectionString)) {
    throw new Error(
      `${DEPOSIT_REQUEST_RETRY_KEY_VERSION} is missing and no usable SUPABASE_DB_URL/Postgres URL is configured`
    );
  }
  console.log("Applying migration-line-guest-notification-deposit-request-retry-key.sql …");
  await applyMigration(connectionString, DEPOSIT_REQUEST_RETRY_KEY_SQL);
  if (!(await migrationApplied(DEPOSIT_REQUEST_RETRY_KEY_VERSION))) {
    throw new Error(`${DEPOSIT_REQUEST_RETRY_KEY_VERSION} ran but ledger verification failed`);
  }
  console.log(`OK: ${DEPOSIT_REQUEST_RETRY_KEY_VERSION} ready`);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
