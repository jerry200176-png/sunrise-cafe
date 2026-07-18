import { describe, expect, it } from "vitest";
import { fetchMigrationDrift, formatDriftReport, isRealSupabaseConfigured } from "@/lib/migration-verify";

/**
 * CI gate — fails when production DB is behind code or probe is unavailable.
 * Run with CHECK_MIGRATION_DRIFT=1 and real Supabase credentials.
 *
 * PASS only when every tracked version is Applied (ledger) and closed_dates present.
 * Case B Candidate / True Pending / Unknown / Probe Error → fail (no auto ledger write).
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
            ? "Probe/transport failure — fix connectivity."
            : report.case_b_candidates.length
              ? "Case B Candidate — human review + explicit reconcile tool (not auto-apply)."
              : report.unknown.length
                ? "Unknown — PostgREST cannot prove indexes/policies/constraints; Founder catalog review."
                : "True Pending — apply migration DDL via reviewed production migration path.")
      ).toBe(true);
      expect(report.status).toBe("pass");
    }
  );
});
