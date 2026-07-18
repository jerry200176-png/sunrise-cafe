import { describe, expect, it } from "vitest";
import { fetchMigrationDrift, formatDriftReport, isRealSupabaseConfigured } from "@/lib/migration-verify";

/**
 * CI gate — fails when production DB is behind code or probe is unavailable.
 * Run with CHECK_MIGRATION_DRIFT=1 and real Supabase credentials.
 *
 * Distinguishes:
 * - status=drift → missing migrations / Case B ledger gap
 * - status=probe_error → transport/auth failure (not reported as pending list)
 */
describe("migration drift CI gate", () => {
  it.skipIf(!process.env.CHECK_MIGRATION_DRIFT || !isRealSupabaseConfigured())(
    "production DB must pass migration drift verification",
    async () => {
      const report = await fetchMigrationDrift();
      expect(
        report.ok,
        `Migration verification failed (${report.status}):\n${formatDriftReport(report)}\n` +
          (report.status === "probe_error"
            ? "Probe/transport failure — fix connectivity; this is not a pending-migration list."
            : report.schema_present_ledger_missing.length
              ? "Case B: run node scripts/reconcile-migration-ledger.mjs --apply (after dry-run)."
              : "Run docs/OPS_MIGRATION_RUNBOOK.md for true pending DDL.")
      ).toBe(true);
      expect(report.status).toBe("pass");
    }
  );
});
