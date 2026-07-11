import { describe, expect, it } from "vitest";
import { fetchMigrationDrift, formatDriftReport, isRealSupabaseConfigured } from "@/lib/migration-verify";

/**
 * CI gate — fails when production DB is behind code.
 * Run with CHECK_MIGRATION_DRIFT=1 and real Supabase credentials.
 */
describe("migration drift CI gate", () => {
  it.skipIf(!process.env.CHECK_MIGRATION_DRIFT || !isRealSupabaseConfigured())(
    "production DB must have all critical migrations applied",
    async () => {
      const report = await fetchMigrationDrift();
      expect(
        report.ok,
        `Migration drift detected:\n${formatDriftReport(report)}\nRun docs/OPS_MIGRATION_RUNBOOK.md`
      ).toBe(true);
    }
  );
});
