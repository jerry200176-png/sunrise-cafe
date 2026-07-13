/**
 * Migration drift detection — code vs production DB.
 * Used by verify:migrations, Outcome Pipeline, and verify-production workflow.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const TRACKED_MIGRATIONS = [
  {
    version: "20260710-reservations-no-overlap",
    file: "migration-reservations-no-overlap.sql",
    critical: true,
  },
  {
    version: "20260710-phase7-rbac",
    file: "migration-phase7-rbac.sql",
    critical: true,
  },
  {
    version: "20260713-ops-events",
    file: "migration-ops-events.sql",
    critical: false,
  },
] as const;

export const CLOSED_DATES_FILE = "migration-branches-closed-dates.sql";

export type MigrationDriftReport = {
  ok: boolean;
  mode: "static" | "remote" | "unconfigured";
  schema_migrations_table: boolean;
  applied: string[];
  pending: string[];
  overlap_constraint_active: boolean;
  closed_dates_column: boolean;
  rbac_tables: boolean;
  errors: string[];
};

export function isRealSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return false;
  if (url.includes("placeholder")) return false;
  if (key.includes("placeholder")) return false;
  return true;
}

/** Static checks — no DB; always safe in CI. */
export function verifyMigrationArtifacts(repoRoot: string): string[] {
  const errors: string[] = [];
  const supabaseDir = join(repoRoot, "supabase");

  for (const m of TRACKED_MIGRATIONS) {
    const path = join(supabaseDir, m.file);
    if (!existsSync(path)) {
      errors.push(`Missing migration file: supabase/${m.file}`);
      continue;
    }
    if (m.critical) {
      const content = readFileSync(path, "utf8");
      if (!content.includes("schema_migrations")) {
        errors.push(`${m.file} should record version in schema_migrations`);
      }
      if (!content.includes(m.version)) {
        errors.push(`${m.file} should INSERT version ${m.version}`);
      }
    }
  }

  const closedPath = join(supabaseDir, CLOSED_DATES_FILE);
  if (!existsSync(closedPath)) {
    errors.push(`Missing migration file: supabase/${CLOSED_DATES_FILE}`);
  }

  return errors;
}

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Query production/staging DB for applied migrations and schema probes. */
export async function fetchMigrationDrift(): Promise<MigrationDriftReport> {
  if (!isRealSupabaseConfigured()) {
    return {
      ok: true,
      mode: "unconfigured",
      schema_migrations_table: false,
      applied: [],
      pending: TRACKED_MIGRATIONS.map((m) => m.version),
      overlap_constraint_active: false,
      closed_dates_column: false,
      rbac_tables: false,
      errors: [],
    };
  }

  const errors: string[] = [];
  let applied: string[] = [];
  let overlapActive = false;
  let closedDatesColumn = false;
  let rbacTables = false;
  let schemaMigrationsTable = false;

  try {
    const { data: migrations, error } = await db()
      .from("schema_migrations")
      .select("version")
      .order("applied_at", { ascending: true });

    if (error) {
      errors.push(`schema_migrations query failed: ${error.message}`);
    } else if (migrations) {
      schemaMigrationsTable = true;
      applied = migrations.map((m) => m.version as string);
      overlapActive = applied.includes("20260710-reservations-no-overlap");
    }

    const { error: rbacErr } = await db().from("admin_users").select("id").limit(1);
    if (!rbacErr) rbacTables = true;

    const { error: closedErr } = await db().from("branches").select("closed_dates").limit(1);
    if (!closedErr) closedDatesColumn = true;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const pending = TRACKED_MIGRATIONS.map((m) => m.version).filter((v) => !applied.includes(v));
  const ok = errors.length === 0 && pending.length === 0 && closedDatesColumn;

  return {
    ok,
    mode: "remote",
    schema_migrations_table: schemaMigrationsTable,
    applied,
    pending,
    overlap_constraint_active: overlapActive,
    closed_dates_column: closedDatesColumn,
    rbac_tables: rbacTables,
    errors,
  };
}

export function formatDriftReport(report: MigrationDriftReport): string {
  const lines = [
    `mode: ${report.mode}`,
    `ok: ${report.ok}`,
    `applied: ${report.applied.join(", ") || "(none)"}`,
    `pending: ${report.pending.join(", ") || "(none)"}`,
    `overlap: ${report.overlap_constraint_active}`,
    `closed_dates: ${report.closed_dates_column}`,
    `rbac: ${report.rbac_tables}`,
  ];
  if (report.errors.length) lines.push(`errors: ${report.errors.join("; ")}`);
  return lines.join("\n");
}
