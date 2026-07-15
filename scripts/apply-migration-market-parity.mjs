#!/usr/bin/env node
/**
 * Apply market-parity Round 3–7 columns (guest_confirmed_at, deposit_urgent…, waitlist staff_*).
 * DDL requires SUPABASE_DB_URL (or POSTGRES_URL*). Probes use REST fetch (no supabase-js Realtime).
 *
 * Usage:
 *   SUPABASE_DB_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/apply-migration-market-parity.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, "../supabase/migration-market-parity-rounds-3-7.sql"),
  "utf8"
);

const PROBES = [
  { table: "reservations", column: "guest_confirmed_at" },
  { table: "reservations", column: "deposit_urgent_reminder_sent_at" },
  { table: "waitlist", column: "staff_called_at" },
  { table: "waitlist", column: "staff_alerted_at" },
];

function restBase() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(
    /\/$/,
    ""
  );
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

function pgUrl() {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.DATABASE_URL ??
    ""
  );
}

function isPlaceholderDbUrl(url) {
  if (!url) return true;
  return (
    url.includes("[region]") ||
    url.includes("[ref]") ||
    url.includes("[YOUR") ||
    url.includes(":[") // e.g. :[PASSWORD] placeholders
  );
}

async function probeColumn(table, column) {
  const base = restBase();
  const key = serviceKey();
  if (!base || !key || key.startsWith("<") || key.length < 40) {
    return { ok: false, reason: "missing_rest_creds" };
  }
  const res = await fetch(`${base}/rest/v1/${table}?select=${column}&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await res.text();
  if (res.status === 200) return { ok: true, exists: true };
  // column missing
  if (
    res.status === 400 &&
    (/42703/.test(text) || new RegExp(column, "i").test(text))
  ) {
    return { ok: true, exists: false, detail: text.slice(0, 200) };
  }
  // table missing
  if (res.status === 404 && /PGRST205|Could not find the table/i.test(text)) {
    return { ok: true, exists: false, detail: text.slice(0, 200) };
  }
  return { ok: false, reason: `http_${res.status}`, detail: text.slice(0, 300) };
}

async function applyViaPostgres(connectionString) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, { max: 1, idle_timeout: 15, ssl: "require" });
  try {
    await sql.unsafe(SQL);
  } finally {
    await sql.end({ timeout: 10 });
  }
}

async function main() {
  console.log("=== market-parity Round 3–7 migration ===");

  const before = {};
  for (const { table, column } of PROBES) {
    const p = await probeColumn(table, column);
    before[column] = p;
    console.log(`probe ${table}.${column}:`, JSON.stringify(p));
  }

  const allExist =
    PROBES.every((c) => before[c.column]?.exists === true) &&
    PROBES.every((c) => before[c.column]?.ok);

  if (allExist) {
    console.log("OK: all columns already present");
    process.exit(0);
  }

  const conn = pgUrl();
  if (!conn || isPlaceholderDbUrl(conn)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "missing_or_placeholder_SUPABASE_DB_URL",
        hint:
          "Set GitHub Actions secret SUPABASE_DB_URL to Dashboard → Database → URI (Session mode). Cursor Cloud secret is currently a [region] placeholder.",
      })
    );
    process.exit(1);
  }

  console.log("Applying migration-market-parity-rounds-3-7.sql via Postgres…");
  await applyViaPostgres(conn);

  let failed = false;
  for (const { table, column } of PROBES) {
    const p = await probeColumn(table, column);
    console.log(`after ${table}.${column}:`, JSON.stringify(p));
    if (!p.exists) failed = true;
  }
  if (failed) {
    console.error("Apply finished but some columns still missing");
    process.exit(1);
  }
  console.log("OK: market-parity columns ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
