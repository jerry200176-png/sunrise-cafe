/**
 * Schema governance — migration manifest verification and DB health signals.
 */
import manifest from "../../supabase/migrations.manifest.json";

export type MigrationManifest = {
  version: number;
  description: string;
  migrations: string[];
};

export type SchemaDriftReport = {
  expected: string[];
  applied: string[];
  pending: string[];
  extra: string[];
  drift: boolean;
};

export type DbHealthReport = {
  warnings: string[];
  checks: { name: string; ok: boolean; detail: string }[];
};

export function getExpectedMigrations(): string[] {
  const data = manifest as MigrationManifest;
  return [...data.migrations];
}

export function compareSchemaMigrations(appliedNames: string[]): SchemaDriftReport {
  const expected = getExpectedMigrations();
  const appliedSet = new Set(appliedNames);
  const expectedSet = new Set(expected);

  const pending = expected.filter((name) => !appliedSet.has(name));
  const extra = appliedNames.filter((name) => !expectedSet.has(name));

  return {
    expected,
    applied: appliedNames,
    pending,
    extra,
    drift: pending.length > 0 || extra.length > 0,
  };
}

export function buildDbHealth(params: {
  analytics_events_count: number | null;
  reservations_count: number | null;
  retention_days?: number;
}): DbHealthReport {
  const warnings: string[] = [];
  const checks: DbHealthReport["checks"] = [];
  const retention = params.retention_days ?? 730;

  if (params.analytics_events_count != null) {
    const n = params.analytics_events_count;
    const ok = n < 500_000;
    checks.push({
      name: "analytics_volume",
      ok,
      detail: `${n.toLocaleString()} rows (review retention if > 500k)`,
    });
    if (n > 1_000_000) {
      warnings.push(
        `analytics_events 超過 100 萬筆 — 請執行 purge_analytics_events_older_than(${retention})`
      );
    }
  }

  if (params.reservations_count != null) {
    checks.push({
      name: "reservations_volume",
      ok: true,
      detail: `${params.reservations_count.toLocaleString()} rows`,
    });
  }

  const expectedIndexes = [
    "idx_reservations_room_time",
    "idx_analytics_events_created",
    "idx_reservations_cancelled_at",
  ];
  for (const idx of expectedIndexes) {
    checks.push({
      name: `index_${idx}`,
      ok: true,
      detail: `Expected in production after phase6-scale-indexes migration`,
    });
  }

  return { warnings, checks };
}
