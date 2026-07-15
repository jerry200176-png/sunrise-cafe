#!/usr/bin/env node
/**
 * Apply ops_events table if missing (OPS-004b).
 * Probes via REST fetch (Node 20-safe). DDL needs SUPABASE_DB_URL / POSTGRES_URL*.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(__dirname, "../supabase/migration-ops-events.sql"), "utf8");

async function probeTable(url, key) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/ops_events?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (res.status === 200) return { exists: true };
  if (/PGRST205|does not exist|42P01/i.test(text)) {
    return { exists: false, message: text.slice(0, 200) };
  }
  throw new Error(`ops_events probe HTTP ${res.status}: ${text.slice(0, 300)}`);
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
    process.env.DATABASE_URL;

  if (!url && !pgUrl) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_URL");
    process.exit(1);
  }

  if (url && serviceKey && !serviceKey.startsWith("<") && serviceKey.length > 40) {
    const probe = await probeTable(url, serviceKey);
    if (probe.exists) {
      console.log("OK: ops_events already exists");
      return;
    }
    console.log("Table missing:", probe.message);
  }

  if (!pgUrl || pgUrl.includes("[ref]") || pgUrl.includes("[region]")) {
    console.error(
      "ops_events missing but no valid Postgres URL. Set SUPABASE_DB_URL in repo Secrets or call production API."
    );
    process.exit(1);
  }

  console.log("Applying migration via Postgres...");
  await applyViaPostgres(pgUrl);

  if (url && serviceKey && !serviceKey.startsWith("<") && serviceKey.length > 40) {
    const after = await probeTable(url, serviceKey);
    if (!after.exists) throw new Error("Migration ran but ops_events still missing");
  }
  console.log("OK: migration-ops-events applied");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
