/**
 * Migration drift detection — code vs production DB.
 * Uses PostgREST HTTP only (no Supabase realtime / WebSocket).
 *
 * Classification (per tracked version):
 * - applied: ledger has version
 * - case_b_candidate: ledger missing AND every evidence item proven present
 * - true_pending: ledger missing AND at least one REST evidence proven absent
 * - unknown: ledger missing AND some evidence cannot be introspected / inconclusive
 * - (report-level) probe_error: cannot reliably read ledger or probes
 *
 * PASS only when every tracked version is applied (and closed_dates column present).
 * Case B / true pending / unknown → FAIL (honest; no auto ledger write).
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import bundledContracts from "../../supabase/tracked-migration-contracts.json";

export type EvidenceIntrospect = "rest" | "unsupported";

export type EvidenceSpec = {
  type: string;
  name?: string;
  table?: string;
  introspect: EvidenceIntrospect;
  note?: string;
};

export type TrackedMigrationContract = {
  version: string;
  file: string;
  critical: boolean;
  evidence: EvidenceSpec[];
};

export type EvidenceResultStatus = "present" | "absent" | "unknown" | "unsupported";

export type EvidenceResult = EvidenceSpec & {
  status: EvidenceResultStatus;
};

export type VersionClassification =
  | "applied"
  | "case_b_candidate"
  | "true_pending"
  | "unknown";

export type VersionAssessment = {
  version: string;
  classification: VersionClassification;
  evidence: EvidenceResult[];
};

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
  /** Versions not Applied (Case B / true pending / unknown) */
  pending: string[];
  case_b_candidates: string[];
  true_pending: string[];
  unknown: string[];
  classifications: VersionAssessment[];
  closed_dates_column: boolean;
  /** Compatibility: ledger contains overlap version (constraint itself not REST-proven). */
  overlap_constraint_active: boolean;
  /** Compatibility: admin_users REST-readable */
  rbac_tables: boolean;
  /** Compatibility: ops_events REST-readable */
  ops_events_table: boolean;
  errors: string[];
};

/** @deprecated alias — prefer loadTrackedMigrationContracts */
export type TrackedMigration = TrackedMigrationContract;

const CONTRACTS_REL = join("supabase", "tracked-migration-contracts.json");

export function loadTrackedMigrationContracts(
  repoRoot?: string
): TrackedMigrationContract[] {
  if (repoRoot) {
    const path = join(repoRoot, CONTRACTS_REL);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8")) as TrackedMigrationContract[];
    }
  }
  return bundledContracts as TrackedMigrationContract[];
}

/** Lazy default from bundled contracts (tests may override via evaluate input). */
export const TRACKED_MIGRATIONS: TrackedMigrationContract[] =
  loadTrackedMigrationContracts();

export const CLOSED_DATES_FILE = "migration-branches-closed-dates.sql";

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
  const contracts = loadTrackedMigrationContracts(repoRoot);

  for (const m of contracts) {
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
    if (!m.evidence?.length) {
      errors.push(`${m.version} contract must declare evidence[]`);
    }
  }

  const closedPath = join(supabaseDir, CLOSED_DATES_FILE);
  if (!existsSync(closedPath)) {
    errors.push(`Missing migration file: supabase/${CLOSED_DATES_FILE}`);
  }

  const contractsPath = join(repoRoot, CONTRACTS_REL);
  if (!existsSync(contractsPath)) {
    errors.push(`Missing ${CONTRACTS_REL}`);
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

/**
 * Select value that probes table existence without assuming any column
 * (composite-PK tables such as admin_user_branches have no `id`).
 */
export const TABLE_PROBE_SELECT = "*";

/** Probe a single REST-readable table/column. null = inconclusive. */
export async function probeRestReadable(
  table: string,
  select: string
): Promise<boolean | null> {
  // Resolve the requested column without transferring customer values.
  const result = await restGet<unknown[]>(`${table}?select=${select}&limit=0`, {
    retries: 1,
  });
  if (result.ok) return true;
  if (result.transport) return null;
  if (/PGRST205|42P01|42703|does not exist/i.test(result.error)) return false;
  if (result.status === 401 || result.status === 403) return null;
  return false;
}

/**
 * Classify one migration given ledger membership + per-evidence statuses.
 * Pure — no network.
 */
export function classifyVersion(input: {
  inLedger: boolean;
  evidence: EvidenceResult[];
}): VersionAssessment["classification"] {
  if (input.inLedger) return "applied";

  const statuses = input.evidence.map((e) => e.status);
  if (statuses.some((s) => s === "absent")) return "true_pending";
  if (statuses.some((s) => s === "unsupported" || s === "unknown")) return "unknown";
  if (statuses.length > 0 && statuses.every((s) => s === "present")) {
    return "case_b_candidate";
  }
  return "unknown";
}

/**
 * Resolve evidence statuses from a map of rest probe keys `table.select` → boolean|null.
 * Unsupported specs always → unsupported.
 */
export function resolveEvidenceResults(
  evidence: EvidenceSpec[],
  restProbes: Record<string, boolean | null>
): EvidenceResult[] {
  return evidence.map((spec) => {
    if (spec.introspect === "unsupported") {
      return { ...spec, status: "unsupported" as const };
    }
    if (spec.type === "table" && spec.name) {
      const key = `${spec.name}.${TABLE_PROBE_SELECT}`;
      const alt = Object.keys(restProbes).find((k) => k.startsWith(`${spec.name}.`));
      const v = restProbes[key] ?? (alt ? restProbes[alt] : null);
      if (v === true) return { ...spec, status: "present" as const };
      if (v === false) return { ...spec, status: "absent" as const };
      return { ...spec, status: "unknown" as const };
    }
    if (spec.type === "column" && spec.table && spec.name) {
      const key = `${spec.table}.${spec.name}`;
      const v = restProbes[key];
      if (v === true) return { ...spec, status: "present" as const };
      if (v === false) return { ...spec, status: "absent" as const };
      return { ...spec, status: "unknown" as const };
    }
    return { ...spec, status: "unknown" as const };
  });
}

/**
 * Pure evaluation of drift given ledger + evidence probe map.
 */
export function evaluateMigrationDrift(input: {
  applied: string[] | null;
  ledgerQueryError?: string;
  transportError?: string;
  contracts?: TrackedMigrationContract[];
  /** key: `${table}.${column}` → true|false|null */
  restProbes?: Record<string, boolean | null>;
  closedDatesColumn?: boolean | null;
}): MigrationDriftReport {
  const contracts = input.contracts ?? TRACKED_MIGRATIONS;

  if (input.transportError) {
    return {
      ok: false,
      status: "probe_error",
      mode: "probe_error",
      schema_migrations_table: false,
      applied: [],
      pending: [],
      case_b_candidates: [],
      true_pending: [],
      unknown: [],
      classifications: [],
      closed_dates_column: false,
      overlap_constraint_active: false,
      rbac_tables: false,
      ops_events_table: false,
      errors: [input.transportError],
    };
  }

  if (input.applied === null) {
    return {
      ok: false,
      status: "probe_error",
      mode: "probe_error",
      schema_migrations_table: false,
      applied: [],
      pending: [],
      case_b_candidates: [],
      true_pending: [],
      unknown: [],
      classifications: [],
      closed_dates_column: input.closedDatesColumn === true,
      overlap_constraint_active: false,
      rbac_tables: false,
      ops_events_table: false,
      errors: [input.ledgerQueryError ?? "ledger unreadable"],
    };
  }

  const applied = input.applied;
  const errors: string[] = [];
  if (input.ledgerQueryError) errors.push(input.ledgerQueryError);

  const restProbes = input.restProbes ?? {};
  const classifications: VersionAssessment[] = contracts.map((m) => {
    const evidence = resolveEvidenceResults(m.evidence, restProbes);
    const classification = classifyVersion({
      inLedger: applied.includes(m.version),
      evidence,
    });
    return { version: m.version, classification, evidence };
  });

  const case_b_candidates = classifications
    .filter((c) => c.classification === "case_b_candidate")
    .map((c) => c.version);
  const true_pending = classifications
    .filter((c) => c.classification === "true_pending")
    .map((c) => c.version);
  const unknown = classifications
    .filter((c) => c.classification === "unknown")
    .map((c) => c.version);
  const pending = classifications
    .filter((c) => c.classification !== "applied")
    .map((c) => c.version);

  const closedOk = input.closedDatesColumn === true;
  const allApplied = classifications.every((c) => c.classification === "applied");
  const drift = !allApplied || !closedOk || errors.length > 0;

  return {
    ok: !drift,
    status: drift ? "drift" : "pass",
    mode: "remote",
    schema_migrations_table: true,
    applied,
    pending,
    case_b_candidates,
    true_pending,
    unknown,
    classifications,
    closed_dates_column: closedOk,
    overlap_constraint_active: applied.includes("20260710-reservations-no-overlap"),
    rbac_tables: restProbes["admin_users.*"] === true,
    ops_events_table: restProbes["ops_events.*"] === true,
    errors,
  };
}

/** Collect REST probes required by contracts. */
export async function collectRestProbes(
  contracts: TrackedMigrationContract[]
): Promise<Record<string, boolean | null>> {
  const keys = new Set<string>();
  for (const m of contracts) {
    for (const e of m.evidence) {
      if (e.introspect !== "rest") continue;
      if (e.type === "table" && e.name) keys.add(`${e.name}.${TABLE_PROBE_SELECT}`);
      if (e.type === "column" && e.table && e.name) keys.add(`${e.table}.${e.name}`);
    }
  }
  // Always probe closed_dates for the separate invariant
  keys.add("branches.closed_dates");

  const out: Record<string, boolean | null> = {};
  await Promise.all(
    [...keys].map(async (key) => {
      const [table, col] = key.split(".");
      out[key] = await probeRestReadable(table, col);
    })
  );
  return out;
}

/** Query production/staging DB for applied migrations and schema probes via HTTP. */
export async function fetchMigrationDrift(): Promise<MigrationDriftReport> {
  const contracts = loadTrackedMigrationContracts();

  if (!isRealSupabaseConfigured()) {
    return {
      ok: true,
      status: "unconfigured",
      mode: "unconfigured",
      schema_migrations_table: false,
      applied: [],
      pending: contracts.map((m) => m.version),
      case_b_candidates: [],
      true_pending: [],
      unknown: [],
      classifications: [],
      closed_dates_column: false,
      overlap_constraint_active: false,
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
      contracts,
    });
  }

  let applied: string[] | null = null;
  let ledgerQueryError: string | undefined;
  if (ledger.ok) {
    applied = ledger.data.map((m) => m.version);
  } else if (/PGRST205|42P01|does not exist/i.test(ledger.error)) {
    applied = [];
    ledgerQueryError = `schema_migrations table missing: ${ledger.error}`;
  } else {
    return evaluateMigrationDrift({
      applied: null,
      transportError: `schema_migrations query failed (HTTP ${ledger.status}): ${ledger.error}`,
      contracts,
    });
  }

  const restProbes = await collectRestProbes(contracts);
  const probeValues = Object.values(restProbes);
  if (probeValues.length > 0 && probeValues.every((v) => v === null)) {
    return evaluateMigrationDrift({
      applied: null,
      transportError:
        "Schema evidence probes failed (transport or auth); cannot assess migration drift",
      contracts,
    });
  }

  return evaluateMigrationDrift({
    applied,
    ledgerQueryError,
    contracts,
    restProbes,
    closedDatesColumn: restProbes["branches.closed_dates"],
  });
}

export function formatDriftReport(report: MigrationDriftReport): string {
  const lines = [
    `status: ${report.status}`,
    `mode: ${report.mode}`,
    `ok: ${report.ok}`,
    `applied: ${report.applied.join(", ") || "(none)"}`,
    `case_b_candidates: ${report.case_b_candidates.join(", ") || "(none)"}`,
    `true_pending: ${report.true_pending.join(", ") || "(none)"}`,
    `unknown: ${report.unknown.join(", ") || "(none)"}`,
    `closed_dates: ${report.closed_dates_column}`,
  ];
  for (const c of report.classifications) {
    lines.push(`  ${c.version}: ${c.classification}`);
  }
  if (report.errors.length) lines.push(`errors: ${report.errors.join("; ")}`);
  return lines.join("\n");
}

/** True only if every evidence item is proven present (eligible for manual Case B apply). */
export function isFullEvidencePresent(evidence: EvidenceResult[]): boolean {
  return evidence.length > 0 && evidence.every((e) => e.status === "present");
}
