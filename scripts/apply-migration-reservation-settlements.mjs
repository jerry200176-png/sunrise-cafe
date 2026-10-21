#!/usr/bin/env node
/**
 * #444 結帳紀錄 migration (20261014-reservation-settlements). NOT additive-only:
 * it swaps reservations_no_overlap_excl for reservations_no_overlap_active_excl
 * (no_show stops blocking the slot), so it runs only under the Founder's F1 decision
 * (chat 2026-10-21, 「2 同意」: run after closing, back up first).
 *
 * Fail-closed gates before anything is written:
 *   1. the SQL file is byte-identical to the approved blob (sha256 pin);
 *   2. the clock is inside the approved window (UTC 15:30-18:30 = 台北 23:30-02:30,
 *      after closing and clear of the UTC 01/07/12/13/19 crons); outside it the runner
 *      defers (exit 0, nothing written) so daytime deploys stay green;
 *   3. a verified, persisted recovery point from THIS job exists: the manifest written by
 *      scripts/pre-migration-backup.sh (PR #475) for this phase, fresh, encrypted, with
 *      its .dump.age file on disk and its upload confirmed (BACKUP_ARTIFACT_ID from the
 *      workflow's upload step). A plaintext dump that dies with the runner is not a
 *      recovery point. Missing/invalid = exit 1, nothing written;
 *   4. in-transaction pre-checks: no unknown statuses, an overlap constraint present, no
 *      overlapping active rows; lock_timeout so a busy table aborts instead of queueing.
 * Then the file body runs in one transaction, row counts are re-checked in the same
 * transaction, PostgREST reloads its schema, and the objects are verified after commit.
 * Rollback: the commented block at the end of the SQL file (clean only while
 * reservation_settlements is empty; the PR body has the full execution package).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

export const VERSION = "20261014-reservation-settlements";
const FILE = "migration-reservation-settlements.sql";
const PHASE = "postdeploy";
/** sha256 of the approved file (git blob d726b07 on main 5e85d15). Any edit needs a new F1 decision. */
export const APPROVED_SHA256 = "1a0e0f0bb1156b5ec12514546468ff9b29e568a440c6c42137697833073b52ab";
/** Approved window in UTC minutes-of-day: [15:30, 18:30). */
export const WINDOW_UTC = { start: 15 * 60 + 30, end: 18 * 60 + 30 };
const BACKUP_MAX_AGE_MS = 30 * 60 * 1000;
const FUNCTIONS = ["extend_reservation_stay", "reservation_hourly_rate", "settle_reservation_checkout"];
const SECURITY_DEFINER = ["extend_reservation_stay", "settle_reservation_checkout"];
const TABLES = ["reservation_extensions", "reservation_settlements"];

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../supabase", FILE), "utf8");

export function assertApprovedSql(input = source) {
  const digest = createHash("sha256").update(input, "utf8").digest("hex");
  if (digest !== APPROVED_SHA256) {
    throw new Error(`${FILE} differs from the Founder-approved content (sha256 ${digest}); refusing to run`);
  }
}

/** Body between the single top-level `BEGIN;` and `COMMIT;`; only comments/blank lines may surround them. */
export function migrationBody(input) {
  const lines = input.split("\n");
  const begin = lines.findIndex((line) => line.trim() === "BEGIN;");
  let commit = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === "COMMIT;") { commit = i; break; }
  }
  const outside = [...lines.slice(0, Math.max(begin, 0)), ...lines.slice(commit + 1)];
  if (begin < 0 || commit <= begin || outside.some((line) => line.trim() && !line.trim().startsWith("--"))) {
    throw new Error("Reservation settlements SQL transaction wrapper changed");
  }
  return lines.slice(begin + 1, commit).join("\n").trim();
}

export function inApprovedWindow(now = new Date()) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= WINDOW_UTC.start && minutes < WINDOW_UTC.end;
}

function parseStamp(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(stamp ?? ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

/**
 * Proves scripts/pre-migration-backup.sh ran and verified a dump in this job, and that the
 * dump left the runner (age-encrypted copy uploaded, artifact id confirmed). Returns safe metadata only.
 * @param {{ env?: Record<string, string | undefined>, now?: Date, phase?: string }} [options]
 */
export function assertRecoveryPoint({ env = process.env, now = new Date(), phase = PHASE } = {}) {
  const dir = env.BACKUP_OUT_DIR || (env.RUNNER_TEMP ? join(env.RUNNER_TEMP, "db-backup") : "");
  const manifestPath = dir && join(dir, "manifest.json");
  if (!manifestPath || !existsSync(manifestPath)) {
    throw new Error("No pre-migration backup manifest in this job (PR #475 step missing or failed); refusing to migrate");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Pre-migration backup manifest is unreadable; refusing to migrate");
  }
  const created = parseStamp(manifest.created_at_utc);
  const age = now.getTime() - created;
  const problems = [];
  if (manifest.label !== phase) problems.push(`label ${manifest.label} != ${phase}`);
  if (manifest.format !== "pg_dump custom" || manifest.schema !== "public") problems.push("unexpected dump format/schema");
  if (!Number.isFinite(created) || age < -60_000 || age > BACKUP_MAX_AGE_MS) problems.push("manifest not from this job (stale or future timestamp)");
  if (!(Number(manifest.bytes) >= 1000)) problems.push("dump too small");
  if (!(Number(manifest.tables_with_data) >= 1)) problems.push("no table data in dump");
  if (!/^[0-9a-f]{64}$/.test(String(manifest.sha256 ?? ""))) problems.push("missing dump sha256");
  if (manifest.encrypted !== true) {
    problems.push("dump not encrypted, so it cannot be uploaded and dies with the runner (set BACKUP_AGE_RECIPIENT)");
  } else {
    const artifact = join(dir, `sunrise-cafe_${phase}_${manifest.created_at_utc}.dump.age`);
    if (!existsSync(artifact) || statSync(artifact).size < 1) problems.push("encrypted dump file missing");
    // production-deploy-migrate.yml passes steps.upload.outputs.artifact-id: the ciphertext
    // left the runner (backup -> upload -> verify upload) before this migration may start.
    if (!/^\d+$/.test(String(env.BACKUP_ARTIFACT_ID ?? ""))) problems.push("encrypted backup upload not confirmed (no BACKUP_ARTIFACT_ID)");
  }
  if (problems.length) throw new Error(`Pre-migration backup is not a usable recovery point: ${problems.join("; ")}`);
  return {
    backup_sha256: manifest.sha256,
    backup_bytes: Number(manifest.bytes),
    backup_created_at_utc: manifest.created_at_utc,
    backup_artifact_id: String(env.BACKUP_ARTIFACT_ID),
  };
}

async function hasVersion(sql) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${VERSION} LIMIT 1`;
  return rows.length === 1;
}

async function counts(tx) {
  const [row] = await tx`
    SELECT (SELECT count(*)::int FROM reservations) AS reservations,
           (SELECT count(*)::int FROM reservations WHERE status = 'no_show') AS no_show,
           (SELECT count(*)::int FROM orders) AS orders`;
  return row;
}

/** Runs inside the migration transaction, before the body. Throws to roll back. */
export async function preChecks(tx) {
  await tx.unsafe("SET LOCAL lock_timeout = '5s'");
  await tx.unsafe("SET LOCAL statement_timeout = '120s'");
  const [unknown] = await tx`
    SELECT count(*)::int AS n FROM reservations
     WHERE status IS NULL OR status::text NOT IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed', 'no_show')`;
  if (unknown.n !== 0) throw new Error(`Pre-check failed: ${unknown.n} reservations with an unknown status`);
  const constraints = await tx`
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.reservations'::regclass
       AND conname IN ('reservations_no_overlap_excl', 'reservations_no_overlap_active_excl')`;
  if (constraints.length === 0) throw new Error("Pre-check failed: no reservations overlap constraint present (unexpected schema)");
  const [overlap] = await tx`
    SELECT count(*)::int AS n FROM reservations a JOIN reservations b
      ON a.room_id = b.room_id AND a.id < b.id
     WHERE a.status NOT IN ('cancelled', 'no_show') AND b.status NOT IN ('cancelled', 'no_show')
       AND tstzrange(a.start_time, a.end_time, '[)') && tstzrange(b.start_time, b.end_time, '[)')`;
  if (overlap.n !== 0) throw new Error(`Pre-check failed: ${overlap.n} overlapping active reservation pairs`);
  return { ...(await counts(tx)), old_constraint_present: constraints.some((c) => c.conname === "reservations_no_overlap_excl") };
}

/**
 * @param sql postgres.js client
 * @param opts.now clock (test seam); opts.recoveryPoint backup gate (test seam)
 */
export async function applyReservationSettlements(sql, { input = source, now = new Date(), recoveryPoint = assertRecoveryPoint } = {}) {
  assertApprovedSql(input);
  const body = migrationBody(input);
  if (await hasVersion(sql)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
    return verify(sql, "already_applied");
  }
  if (!inApprovedWindow(now)) {
    const message = `${VERSION} pending: outside the approved window (UTC 15:30-18:30 / 台北 23:30-02:30); nothing written`;
    console.log(`::warning::${message}`);
    return { ledger: VERSION, status: "deferred_outside_window" };
  }
  const backup = recoveryPoint({ now });
  let before;
  let after;
  await sql.begin(async (tx) => {
    before = await preChecks(tx);
    await tx.unsafe(body);
    after = await counts(tx);
    if (after.reservations !== before.reservations || after.orders !== before.orders || after.no_show !== before.no_show) {
      throw new Error("Row counts changed inside the migration transaction; rolled back");
    }
    await tx.unsafe("NOTIFY pgrst, 'reload schema'");
  });
  if (!(await hasVersion(sql))) throw new Error(`${VERSION} missing from schema_migrations`);
  return { ...(await verify(sql, "applied")), backup, pre_checks: before };
}

export async function verify(sql, status) {
  const tables = await sql`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${sql.array(TABLES)}) ORDER BY c.relname`;
  if (tables.map((t) => t.relname).join(",") !== TABLES.join(",")) throw new Error("settlement tables missing");
  if (tables.some((t) => !t.relrowsecurity)) throw new Error("settlement tables without RLS");
  const fns = await sql`
    SELECT p.proname, p.prosecdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(${sql.array(FUNCTIONS)}) ORDER BY p.proname`;
  if (fns.map((f) => f.proname).join(",") !== FUNCTIONS.join(",")) throw new Error("settlement functions missing");
  for (const fn of fns) {
    if (fn.anon_exec || fn.auth_exec || !fn.service_exec) throw new Error(`${fn.proname} EXECUTE grants are not service_role-only`);
    if (SECURITY_DEFINER.includes(fn.proname) && !fn.prosecdef) throw new Error(`${fn.proname} is not SECURITY DEFINER`);
  }
  const constraints = await sql`
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.reservations'::regclass
       AND conname IN ('reservations_no_overlap_excl', 'reservations_no_overlap_active_excl') ORDER BY conname`;
  if (constraints.map((c) => c.conname).join(",") !== "reservations_no_overlap_active_excl") {
    throw new Error("overlap constraint swap incomplete");
  }
  const [rows] = await sql`SELECT count(*)::int AS n FROM reservation_settlements`;
  return { ledger: VERSION, status, tables: TABLES.length, functions: FUNCTIONS.length, settlement_rows: rows.n };
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyReservationSettlements(sql) }));
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
