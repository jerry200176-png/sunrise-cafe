/**
 * Migration drift detection — code vs production DB.
 * Uses PostgREST HTTP only (no Supabase realtime / WebSocket).
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const TRACKED_MIGRATIONS = [
  {
    version: "20260710-reservations-no-overlap",
    file: "migration-reservations-no-overlap.sql",
    critical: true,
    /** REST effect probe — exclusion constraint is not visible via PostgREST; ledger is primary. */
    effect: "ledger_primary" as const,
  },
  {
    version: "20260710-phase7-rbac",
    file: "migration-phase7-rbac.sql",
    critical: true,
    effect: "admin_users" as const,
  },
  {
    version: "20260713-ops-events",
    file: "migration-ops-events.sql",
    critical: false,
    effect: "ops_events" as const,
  },
  {
    version: "20260715-rls-catalog-read-only",
    file: "migration-rls-catalog-read-only.sql",
    critical: true,
    /** Policies are not reliably introspectable via REST; ledger is primary. */
    effect: "ledger_primary" as const,
  },
] as const;

export const CLOSED_DATES_FILE = "migration-branches-closed-dates.sql";

export type DriftStatus =
  | "pass"
  | "drift"
  | "probe_error"
  | "unconfigured";

export type MigrationDriftReport = {
  ok: boolean;
  status: DriftStatus;
  mode: "static" | "remote" | "unconfigured" | "probe_error";
  schema_migrations_table: boolean;
  applied: string[];
  pending: string[];
  /** Versions whose schema effect is present but ledger row is missing */
  schema_present_ledger_missing: string[];
  overlap_constraint_active: boolean;
  closed_dates_column: boolean;
  rbac_tables: boolean;
  ops_events_table: boolean;
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

type RestResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; transport?: boolean };

async function restGet<T>(
  pathAndQuery: string,
  opts?: { retries?: number }
): Promise<RestResult<T>> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const retries = opts?.retries ?? 2;
  let lastErr = "unknown";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: text.slice(0, 400) || `HTTP ${res.status}`,
          transport: false,
        };
      }
      const data = (text ? JSON.parse(text) : []) as T;
      return { ok: true, status: res.status, data };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return { ok: false, status: 0, error: lastErr, transport: true };
    }
  }
  return { ok: false, status: 0, error: lastErr, transport: true };
}

async function tableReadable(table: string, select = "id"): Promise<boolean | null> {
  const result = await restGet<unknown[]>(`${table}?select=${select}&limit=1`, {
    retries: 1,
  });
  if (result.ok) return true;
  if (result.transport) return null;
  // Missing relation / column
  if (/PGRST205|42P01|42703|does not exist/i.test(result.error)) return false;
  // Permission / other — treat as unknown rather than "missing"
  if (result.status === 401 || result.status === 403) return null;
  return false;
}

/**
 * Pure evaluation of drift given ledger + schema probes.
 * Exported for unit tests (no network).
 */
export function evaluateMigrationDrift(input: {
  applied: string[] | null;
  ledgerQueryError?: string;
  transportError?: string;
  rbacTables: boolean | null;
  closedDatesColumn: boolean | null;
  opsEventsTable: boolean | null;
}): MigrationDriftReport {
  if (input.transportError) {
    return {
      ok: false,
      status: "probe_error",
      mode: "probe_error",
      schema_migrations_table: false,
      applied: [],
      pending: [],
      schema_present_ledger_missing: [],
      overlap_constraint_active: false,
      closed_dates_column: false,
      rbac_tables: false,
      ops_events_table: false,
      errors: [input.transportError],
    };
  }

  const applied = input.applied ?? [];
  const schemaMigrationsTable = input.applied !== null;
  const errors: string[] = [];
  if (input.ledgerQueryError) errors.push(input.ledgerQueryError);

  const rbac = input.rbacTables === true;
  const closed = input.closedDatesColumn === true;
  const ops = input.opsEventsTable === true;

  const schemaPresentLedgerMissing: string[] = [];
  for (const m of TRACKED_MIGRATIONS) {
    if (applied.includes(m.version)) continue;
    if (m.effect === "admin_users" && rbac) {
      schemaPresentLedgerMissing.push(m.version);
    } else if (m.effect === "ops_events" && ops) {
      schemaPresentLedgerMissing.push(m.version);
    }
  }

  const pending = TRACKED_MIGRATIONS.map((m) => m.version).filter(
    (v) => !applied.includes(v)
  );

  const pendingCriticalUnresolved = TRACKED_MIGRATIONS.filter((m) => m.critical)
    .map((m) => m.version)
    .filter((v) => !applied.includes(v) && !schemaPresentLedgerMissing.includes(v));

  // closed_dates is required schema effect (separate from TRACKED list)
  const closedOk = closed;
  // Case B (schema present, ledger missing) is still a trust gap — fail until reconciled
  const caseBCritical = schemaPresentLedgerMissing.some((v) =>
    TRACKED_MIGRATIONS.some((m) => m.version === v && m.critical)
  );

  const drift =
    pendingCriticalUnresolved.length > 0 || !closedOk || caseBCritical || errors.length > 0;

  // If ledger query failed but we have no transport error, still treat as drift/probe issue
  if (input.applied === null && input.ledgerQueryError) {
    return {
      ok: false,
      status: "probe_error",
      mode: "probe_error",
      schema_migrations_table: false,
      applied: [],
      pending: [],
      schema_present_ledger_missing: schemaPresentLedgerMissing,
      overlap_constraint_active: false,
      closed_dates_column: closed,
      rbac_tables: rbac,
      ops_events_table: ops,
      errors,
    };
  }

  return {
    ok: !drift,
    status: drift ? "drift" : "pass",
    mode: "remote",
    schema_migrations_table: schemaMigrationsTable,
    applied,
    pending,
    schema_present_ledger_missing: schemaPresentLedgerMissing,
    overlap_constraint_active: applied.includes("20260710-reservations-no-overlap"),
    closed_dates_column: closed,
    rbac_tables: rbac,
    ops_events_table: ops,
    errors,
  };
}

/** Query production/staging DB for applied migrations and schema probes via HTTP. */
export async function fetchMigrationDrift(): Promise<MigrationDriftReport> {
  if (!isRealSupabaseConfigured()) {
    return {
      ok: true,
      status: "unconfigured",
      mode: "unconfigured",
      schema_migrations_table: false,
      applied: [],
      pending: TRACKED_MIGRATIONS.map((m) => m.version),
      schema_present_ledger_missing: [],
      overlap_constraint_active: false,
      closed_dates_column: false,
      rbac_tables: false,
      ops_events_table: false,
      errors: [],
    };
  }

  const ledger = await restGet<{ version: string }[]>(
    "schema_migrations?select=version&order=applied_at.asc",
    { retries: 2 }
  );

  if (!ledger.ok && ledger.transport) {
    return evaluateMigrationDrift({
      applied: null,
      transportError: `PostgREST transport failure: ${ledger.error}`,
      rbacTables: null,
      closedDatesColumn: null,
      opsEventsTable: null,
    });
  }

  let applied: string[] | null = null;
  let ledgerQueryError: string | undefined;
  if (ledger.ok) {
    applied = ledger.data.map((m) => m.version);
  } else if (/PGRST205|42P01|does not exist/i.test(ledger.error)) {
    // Table missing — real drift, not transport failure
    applied = [];
    ledgerQueryError = `schema_migrations table missing: ${ledger.error}`;
  } else {
    // Auth / unexpected API error — cannot trust empty pending list
    return evaluateMigrationDrift({
      applied: null,
      transportError: `schema_migrations query failed (HTTP ${ledger.status}): ${ledger.error}`,
      rbacTables: null,
      closedDatesColumn: null,
      opsEventsTable: null,
    });
  }

  const [rbacTables, closedDatesColumn, opsEventsTable] = await Promise.all([
    tableReadable("admin_users", "id"),
    tableReadable("branches", "closed_dates"),
    tableReadable("ops_events", "id"),
  ]);

  if (
    applied !== null &&
    rbacTables === null &&
    closedDatesColumn === null &&
    opsEventsTable === null
  ) {
    return evaluateMigrationDrift({
      applied: null,
      transportError:
        "Schema effect probes failed (transport or auth); cannot assess migration drift",
      rbacTables,
      closedDatesColumn,
      opsEventsTable,
    });
  }

  return evaluateMigrationDrift({
    applied,
    ledgerQueryError,
    rbacTables,
    closedDatesColumn,
    opsEventsTable,
  });
}

export function formatDriftReport(report: MigrationDriftReport): string {
  const lines = [
    `status: ${report.status}`,
    `mode: ${report.mode}`,
    `ok: ${report.ok}`,
    `applied: ${report.applied.join(", ") || "(none)"}`,
    `pending: ${report.pending.join(", ") || "(none)"}`,
    `schema_present_ledger_missing: ${report.schema_present_ledger_missing.join(", ") || "(none)"}`,
    `overlap: ${report.overlap_constraint_active}`,
    `closed_dates: ${report.closed_dates_column}`,
    `rbac: ${report.rbac_tables}`,
    `ops_events: ${report.ops_events_table}`,
  ];
  if (report.errors.length) lines.push(`errors: ${report.errors.join("; ")}`);
  return lines.join("\n");
}
