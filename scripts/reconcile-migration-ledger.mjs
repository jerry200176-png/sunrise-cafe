#!/usr/bin/env node
/**
 * Manual ledger reconciliation tool (NOT used by Verify Production).
 *
 * Dry-run (default): classify tracked migrations / a single --migration.
 * Apply: INSERT one schema_migrations row only when:
 *   --migration <version>
 *   --confirm-version <same version>
 *   --apply
 *   full evidence contract is proven present (no unsupported/unknown/absent)
 *   version not already in ledger
 *   DB URL project ref matches NEXT_PUBLIC_SUPABASE_URL project ref
 *
 * Never runs migration DDL.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONTRACTS_PATH = join(ROOT, "supabase/tracked-migration-contracts.json");

function parseArgs(argv) {
  const out = { apply: false, migration: null, confirm: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--migration") out.migration = argv[++i] ?? null;
    else if (a === "--confirm-version") out.confirm = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function projectRefFromSupabaseUrl(url) {
  const m = String(url || "").match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

function projectRefFromDbUrl(dbUrl) {
  try {
    const u = new URL(dbUrl);
    // user or host often contains project ref
    const host = u.hostname || "";
    const user = decodeURIComponent(u.username || "");
    const fromHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
    if (fromHost) return fromHost;
    if (/^[a-z0-9]+$/.test(user)) return user;
    return null;
  } catch {
    return null;
  }
}

function pgUrl() {
  const url =
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    "";
  if (!url || url.includes("[region]") || url.includes("[ref]") || url.includes("placeholder")) {
    return null;
  }
  return url;
}

async function restGet(url, key, path) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  return { status: res.status, text, ok: res.status >= 200 && res.status < 300 };
}

async function probeColumn(url, key, table, column) {
  const r = await restGet(url, key, `${table}?select=${column}&limit=1`);
  if (r.ok) return "present";
  if (/PGRST205|42P01|42703|does not exist/i.test(r.text)) return "absent";
  if (r.status === 401 || r.status === 403 || r.status === 0) return "unknown";
  return "absent";
}

async function evaluateEvidence(url, key, evidence) {
  const results = [];
  for (const spec of evidence) {
    if (spec.introspect === "unsupported") {
      results.push({ ...spec, status: "unsupported" });
      continue;
    }
    if (spec.type === "table" && spec.name) {
      const status = await probeColumn(url, key, spec.name, "id");
      results.push({ ...spec, status });
      continue;
    }
    if (spec.type === "column" && spec.table && spec.name) {
      const status = await probeColumn(url, key, spec.table, spec.name);
      results.push({ ...spec, status });
      continue;
    }
    results.push({ ...spec, status: "unknown" });
  }
  return results;
}

function classify(inLedger, evidence) {
  if (inLedger) return "applied";
  if (evidence.some((e) => e.status === "absent")) return "true_pending";
  if (evidence.some((e) => e.status === "unsupported" || e.status === "unknown")) {
    return "unknown";
  }
  if (evidence.length && evidence.every((e) => e.status === "present")) {
    return "case_b_candidate";
  }
  return "unknown";
}

function fullEvidencePresent(evidence) {
  return evidence.length > 0 && evidence.every((e) => e.status === "present");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/reconcile-migration-ledger.mjs [--migration VERSION]
  node scripts/reconcile-migration-ledger.mjs --migration VERSION --confirm-version VERSION --apply

Dry-run is diagnostic only. --apply requires matching --migration and --confirm-version,
full proven evidence (no unsupported items), and matching Supabase project refs.`);
    process.exit(0);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes("placeholder") || key.includes("placeholder")) {
    console.error("Missing real NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const contracts = JSON.parse(readFileSync(CONTRACTS_PATH, "utf8"));
  const selected = args.migration
    ? contracts.filter((c) => c.version === args.migration)
    : contracts;

  if (args.migration && selected.length === 0) {
    console.error(`Unknown --migration version: ${args.migration}`);
    process.exit(1);
  }

  if (args.apply) {
    if (!args.migration) {
      console.error("--apply requires --migration <version> (batch apply forbidden)");
      process.exit(1);
    }
    if (!args.confirm) {
      console.error("--apply requires --confirm-version <version>");
      process.exit(1);
    }
    if (args.confirm !== args.migration) {
      console.error(
        `--confirm-version (${args.confirm}) must exactly match --migration (${args.migration})`
      );
      process.exit(1);
    }
  }

  const ledger = await restGet(url, key, "schema_migrations?select=version&order=applied_at.asc");
  if (!ledger.ok) {
    console.error("schema_migrations read failed:", ledger.status, ledger.text.slice(0, 200));
    process.exit(1);
  }
  const applied = new Set(JSON.parse(ledger.text || "[]").map((r) => r.version));

  const assessments = [];
  for (const c of selected) {
    const evidence = await evaluateEvidence(url, key, c.evidence);
    const classification = classify(applied.has(c.version), evidence);
    assessments.push({
      version: c.version,
      file: c.file,
      classification,
      evidence: evidence.map((e) => ({
        type: e.type,
        name: e.name,
        table: e.table,
        status: e.status,
      })),
      full_evidence_present: fullEvidencePresent(evidence),
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run-diagnostic",
        note: args.apply
          ? "Attempting single-version ledger INSERT after evidence gate"
          : "Diagnostic only — does not write schema_migrations; dry-run success ≠ migration complete",
        assessments,
      },
      null,
      2
    )
  );

  if (!args.apply) {
    process.exit(0);
  }

  const target = assessments[0];
  if (target.classification === "applied") {
    console.error("Version already in ledger — nothing to apply");
    process.exit(1);
  }
  if (!target.full_evidence_present) {
    console.error(
      "Refuse apply: full evidence contract not proven present (unsupported/unknown/absent remain). " +
        "PostgREST cannot prove indexes/policies/constraints — use catalog review, not ledger patch."
    );
    process.exit(1);
  }

  const conn = pgUrl();
  if (!conn) {
    console.error("SUPABASE_DB_URL (or POSTGRES_URL*) required for --apply");
    process.exit(1);
  }

  const apiRef = projectRefFromSupabaseUrl(url);
  const dbRef = projectRefFromDbUrl(conn);
  if (!apiRef || !dbRef || apiRef !== dbRef) {
    console.error(
      `Refuse apply: project ref mismatch or unparseable (api=${apiRef} db=${dbRef})`
    );
    process.exit(1);
  }

  // Re-check ledger + evidence immediately before write
  const ledger2 = await restGet(url, key, "schema_migrations?select=version");
  if (!ledger2.ok) {
    console.error("pre-write ledger re-check failed");
    process.exit(1);
  }
  const applied2 = new Set(JSON.parse(ledger2.text || "[]").map((r) => r.version));
  if (applied2.has(args.migration)) {
    console.error("Version appeared in ledger during run — abort");
    process.exit(1);
  }
  const evidence2 = await evaluateEvidence(url, key, selected[0].evidence);
  if (!fullEvidencePresent(evidence2)) {
    console.error("Evidence no longer fully present — abort");
    process.exit(1);
  }

  const sql = postgres(conn, { max: 1, idle_timeout: 10 });
  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO schema_migrations (version, name)
        VALUES (${args.migration}, ${selected[0].file})
      `;
    });
  } catch (e) {
    console.error("INSERT failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const ledger3 = await restGet(
    url,
    key,
    `schema_migrations?select=version,name&version=eq.${encodeURIComponent(args.migration)}`
  );
  if (!ledger3.ok || !ledger3.text.includes(args.migration)) {
    console.error("Read-back failed — ledger row not visible after INSERT");
    process.exit(1);
  }
  console.log(`ledger insert confirmed: ${args.migration}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
