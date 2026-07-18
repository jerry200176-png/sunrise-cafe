import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import {
  TRACKED_MIGRATIONS,
  CLOSED_DATES_FILE,
  verifyMigrationArtifacts,
  fetchMigrationDrift,
  evaluateMigrationDrift,
  isRealSupabaseConfigured,
  formatDriftReport,
} from "@/lib/migration-verify";

const REPO_ROOT = join(__dirname, "../..");

describe("verifyMigrationArtifacts (static)", () => {
  it("all tracked migration files exist with schema_migrations records", () => {
    const errors = verifyMigrationArtifacts(REPO_ROOT);
    expect(errors).toEqual([]);
  });

  it("lists expected tracked versions", () => {
    expect(TRACKED_MIGRATIONS.map((m) => m.version)).toContain(
      "20260710-reservations-no-overlap"
    );
    expect(existsSync(join(REPO_ROOT, "supabase", CLOSED_DATES_FILE))).toBe(true);
  });
});

describe("evaluateMigrationDrift", () => {
  const allApplied = TRACKED_MIGRATIONS.map((m) => m.version);

  it("passes when ledger and schema effects match", () => {
    const report = evaluateMigrationDrift({
      applied: allApplied,
      rbacTables: true,
      closedDatesColumn: true,
      opsEventsTable: true,
    });
    expect(report.status).toBe("pass");
    expect(report.ok).toBe(true);
    expect(report.pending).toEqual([]);
  });

  it("fails as drift when a critical ledger row is missing and no schema evidence", () => {
    const report = evaluateMigrationDrift({
      applied: allApplied.filter((v) => v !== "20260715-rls-catalog-read-only"),
      rbacTables: true,
      closedDatesColumn: true,
      opsEventsTable: true,
    });
    expect(report.status).toBe("drift");
    expect(report.ok).toBe(false);
    expect(report.pending).toContain("20260715-rls-catalog-read-only");
  });

  it("does not misreport transport failure as pending migrations", () => {
    const report = evaluateMigrationDrift({
      applied: null,
      transportError: "Node.js 20 detected without native WebSocket support.",
      rbacTables: null,
      closedDatesColumn: null,
      opsEventsTable: null,
    });
    expect(report.status).toBe("probe_error");
    expect(report.ok).toBe(false);
    expect(report.pending).toEqual([]);
    expect(formatDriftReport(report)).toMatch(/probe_error/);
    expect(formatDriftReport(report)).not.toMatch(/pending: 20260710/);
  });

  it("flags Case B when schema effect exists but ledger row is missing", () => {
    const report = evaluateMigrationDrift({
      applied: allApplied.filter((v) => v !== "20260710-phase7-rbac"),
      rbacTables: true,
      closedDatesColumn: true,
      opsEventsTable: true,
    });
    expect(report.schema_present_ledger_missing).toContain("20260710-phase7-rbac");
    expect(report.status).toBe("drift");
    expect(report.ok).toBe(false);
  });
});

describe("fetchMigrationDrift (remote)", () => {
  it.skipIf(isRealSupabaseConfigured())(
    "skips remote when Supabase not configured",
    async () => {
      const report = await fetchMigrationDrift();
      expect(report.mode).toBe("unconfigured");
      expect(report.status).toBe("unconfigured");
      expect(report.ok).toBe(true);
    }
  );

  it.skipIf(!isRealSupabaseConfigured())(
    "reports a structured remote status when DB credentials exist",
    async () => {
      const report = await fetchMigrationDrift();
      expect(["remote", "probe_error"]).toContain(report.mode);
      expect(formatDriftReport(report)).toMatch(/status:/);
    }
  );
});
