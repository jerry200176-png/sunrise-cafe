#!/usr/bin/env node
/**
 * Idempotent apply of:
 *  - migration-rls-catalog-read-only.sql
 *  - migration-refund-requests.sql
 * Detects already-applied via schema_migrations + policy/table probes.
 * Never logs connection secrets.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  logEnvPresence,
  dbUrlLooksReal,
  serviceKeyLooksReal,
  resolveDbUrl,
  restProbe,
} from "./maturity-migrate-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MIGRATIONS = [
  {
    version: "20260715-rls-catalog-read-only",
    file: "supabase/migration-rls-catalog-read-only.sql",
  },
  {
    version: "20260715-refund-requests",
    file: "supabase/migration-refund-requests.sql",
  },
];

async function alreadyApplied(sql, version) {
  const rows = await sql`
    SELECT 1 FROM schema_migrations WHERE version = ${version} LIMIT 1
  `;
  return rows.length > 0;
}

async function main() {
  console.log("=== Apply maturity migrations (RLS + refund_requests) ===");
  const env = logEnvPresence();
  const dbUrl = resolveDbUrl();
  if (!dbUrlLooksReal(dbUrl) || !serviceKeyLooksReal(env.service)) {
    console.error("BLOCKED: invalid secrets shape");
    process.exit(2);
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, idle_timeout: 10, ssl: "require" });

  try {
    for (const m of MIGRATIONS) {
      const applied = await alreadyApplied(sql, m.version).catch(() => false);
      if (applied) {
        console.log(JSON.stringify({ migration: m.version, status: "already_applied" }));
        continue;
      }
      const ddl = readFileSync(join(ROOT, m.file), "utf8");
      console.log(JSON.stringify({ migration: m.version, status: "applying" }));
      await sql.unsafe(ddl);
      console.log(JSON.stringify({ migration: m.version, status: "applied" }));
    }

    // Policy probe (no secrets)
    const policies = await sql`
      SELECT tablename, policyname, cmd
      FROM pg_policies
      WHERE tablename IN ('branches','rooms','settings')
      ORDER BY 1,2
    `;
    console.log(JSON.stringify({ catalog_policies: policies }));

    const hasAllSelect = ["branches", "rooms", "settings"].every((t) =>
      policies.some((p) => p.tablename === t && p.cmd === "SELECT")
    );
    const hasForbiddenAll = policies.some((p) => String(p.cmd).toUpperCase() === "ALL");
    console.log(
      JSON.stringify({
        catalog_select_only: hasAllSelect && !hasForbiddenAll,
        has_forbidden_all_policy: hasForbiddenAll,
      })
    );

    // refund_requests table probe via REST
    const refund = await restProbe(
      env.url,
      env.service,
      "/rest/v1/refund_requests?select=id&limit=1"
    );
    console.log(
      JSON.stringify({
        refund_requests_http: refund.status,
        refund_ready: refund.status === 200,
      })
    );

    if (!hasAllSelect || hasForbiddenAll) {
      throw new Error("RLS policy verification failed");
    }
    if (refund.status !== 200) {
      throw new Error(`refund_requests not ready HTTP ${refund.status}`);
    }
    console.log("APPLY_OK");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
