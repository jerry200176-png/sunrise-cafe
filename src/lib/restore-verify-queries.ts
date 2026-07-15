/**
 * Canonical restore verification queries for isolated drill targets.
 * Script-ready ≠ production-verified — evidence requires LOCAL_DSN drill result.
 */
export const RESTORE_VERIFY_QUERIES = [
  {
    id: "reservations_count",
    sql: "SELECT count(*)::int AS n FROM reservations",
    require: "n >= 0",
  },
  {
    id: "branches_count",
    sql: "SELECT count(*)::int AS n FROM branches",
    require: "n >= 1",
  },
  {
    id: "rooms_count",
    sql: "SELECT count(*)::int AS n FROM rooms",
    require: "n >= 1",
  },
  {
    id: "ops_events_table",
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ops_events'
    ) AS ok`,
    require: "ok = true (after OPS-004b)",
  },
  {
    id: "refund_requests_table",
    sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'refund_requests'
    ) AS ok`,
    require: "ok = true (after maturity migrate)",
  },
] as const;

export type RestoreDrillEvidenceGrade =
  | "script_ready"
  | "validate_only"
  | "isolated_restore_verified"
  | "production_verified";

/** Never promote script-ready or validate_only to A for D06. */
export function restoreEvidenceMeetsA(grade: RestoreDrillEvidenceGrade): boolean {
  return grade === "isolated_restore_verified" || grade === "production_verified";
}
