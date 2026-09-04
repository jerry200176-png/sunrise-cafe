#!/usr/bin/env node
/**
 * Apply the LINE reminder delivery ledger when missing.
 * Probes table + claim RPC via PostgREST; DDL needs a real Postgres URL.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(scriptDir, "../supabase/migration-line-reminder-deliveries.sql"),
  "utf8"
);
const VERSION = "20260902-line-reminder-deliveries";
const PROBE_RESERVATION_ID = "00000000-0000-4000-8000-000000000000";

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
    `${base}/rest/v1/line_reminder_deliveries?select=id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const body = await response.text();
  if (response.status === 200) return true;
  if (response.status === 404 || /PGRST205|does not exist|42P01/i.test(body)) return false;
  throw new Error(
    `line_reminder_deliveries probe HTTP ${response.status}: ${body.slice(0, 300)}`
  );
}

/** True when PostgREST exposes the claim RPC (table alone is not enough). */
async function claimRpcReady() {
  const base = restBase();
  const key = serviceKey();
  if (!base || !hasUsableServiceKey(key)) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(`${base}/rest/v1/rpc/claim_line_reminder_delivery`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      p_reminder_type: "d1_group",
      p_reminder_date: "2099-01-01",
      p_reservation_id: PROBE_RESERVATION_ID,
      p_recipient_type: "group",
      p_recipient_id: "ledger-probe",
    }),
  });
  const body = await response.text();
  if (/PGRST202|Could not find the function/i.test(body)) return false;
  // Empty claim / missing reservation / validation errors prove the RPC is wired.
  if (response.ok || response.status === 200 || response.status === 204) return true;
  if (response.status >= 400 && response.status < 500) return true;
  throw new Error(
    `claim_line_reminder_delivery probe HTTP ${response.status}: ${body.slice(0, 300)}`
  );
}

async function applyMigration(connectionString) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 15, ssl: "require" });
  try {
    await sql.unsafe(SQL);
    await sql.unsafe("NOTIFY pgrst, 'reload schema'");
  } finally {
    await sql.end({ timeout: 10 });
  }
}

async function waitForReady(maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const table = await tableExists();
    const rpc = table ? await claimRpcReady() : false;
    if (table && rpc) return true;
    if (attempt < maxAttempts) {
      const delayMs = attempt * 1000;
      console.log(
        `PostgREST ledger not ready (table=${table} rpc=${rpc}); retrying in ${delayMs}ms …`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

async function main() {
  const connectionString = postgresUrl();
  const table = await tableExists();
  const rpc = table ? await claimRpcReady() : false;
  if (table && rpc) {
    console.log("OK: line_reminder_deliveries + claim_line_reminder_delivery already ready");
    return;
  }

  if (!hasUsablePostgresUrl(connectionString)) {
    throw new Error(
      `LINE reminder delivery ledger incomplete (table=${table} rpc=${rpc}) and no usable SUPABASE_DB_URL/Postgres URL is configured`
    );
  }

  console.log(
    `Applying migration-line-reminder-deliveries.sql (table=${table} rpc=${rpc}) …`
  );
  await applyMigration(connectionString);
  if (!(await waitForReady())) {
    throw new Error(
      "Migration ran but line_reminder_deliveries / claim_line_reminder_delivery is still unavailable to PostgREST"
    );
  }
  console.log(`OK: ${VERSION} ready`);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
