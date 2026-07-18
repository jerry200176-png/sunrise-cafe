#!/usr/bin/env node
/**
 * Safe ledger reconciliation for Case B:
 * schema effect already present, schema_migrations row missing.
 *
 * - Never runs DDL from tracked migration files
 * - Only INSERT … ON CONFLICT DO NOTHING into schema_migrations
 * - Requires SUPABASE_DB_URL (or POSTGRES_URL*) for --apply
 *
 * Usage:
 *   node scripts/reconcile-migration-ledger.mjs           # dry-run (default)
 *   node scripts/reconcile-migration-ledger.mjs --apply
 */
import postgres from "postgres";

const TRACKED = [
  {
    version: "20260710-phase7-rbac",
    file: "migration-phase7-rbac.sql",
    probe: { table: "admin_users", select: "id" },
  },
  {
    version: "20260713-ops-events",
    file: "migration-ops-events.sql",
    probe: { table: "ops_events", select: "id" },
  },
];

function pgUrl() {
  const url =
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    "";
  if (!url || url.includes("[region]") || url.includes("[ref]")) return null;
  return url;
}

async function restGet(url, key, path) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  return { status: res.status, text, ok: res.status >= 200 && res.status < 300 };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes("placeholder")) {
    console.error("Missing real NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const ledger = await restGet(url, key, "schema_migrations?select=version&order=applied_at.asc");
  if (!ledger.ok) {
    console.error("schema_migrations read failed:", ledger.status, ledger.text.slice(0, 200));
    process.exit(1);
  }
  const applied = new Set(JSON.parse(ledger.text || "[]").map((r) => r.version));

  const candidates = [];
  for (const m of TRACKED) {
    if (applied.has(m.version)) continue;
    const probe = await restGet(
      url,
      key,
      `${m.probe.table}?select=${m.probe.select}&limit=1`
    );
    if (probe.ok) {
      candidates.push(m);
    } else {
      console.log(`skip ${m.version}: schema effect not detected (HTTP ${probe.status})`);
    }
  }

  if (candidates.length === 0) {
    console.log("Nothing to reconcile.");
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        will_insert: candidates.map((c) => c.version),
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to INSERT ledger rows.");
    process.exit(0);
  }

  const conn = pgUrl();
  if (!conn) {
    console.error("SUPABASE_DB_URL (or POSTGRES_URL*) required for --apply");
    process.exit(1);
  }

  const sql = postgres(conn, { max: 1, idle_timeout: 10 });
  try {
    for (const c of candidates) {
      await sql`
        INSERT INTO schema_migrations (version, name)
        VALUES (${c.version}, ${c.file})
        ON CONFLICT (version) DO NOTHING
      `;
      console.log(`ledger upserted: ${c.version}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
