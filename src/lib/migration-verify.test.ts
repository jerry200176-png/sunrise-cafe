import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import {
  TRACKED_MIGRATIONS,
  CLOSED_DATES_FILE,
  verifyMigrationArtifacts,
  fetchMigrationDrift,
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

describe("fetchMigrationDrift (remote)", () => {
  it.skipIf(isRealSupabaseConfigured())(
    "skips remote when Supabase not configured",
    async () => {
      const report = await fetchMigrationDrift();
      expect(report.mode).toBe("unconfigured");
      expect(report.ok).toBe(true);
    }
  );

  it.skipIf(!isRealSupabaseConfigured())(
    "reports pending migrations when DB behind code",
    async () => {
      const report = await fetchMigrationDrift();
      expect(report.mode).toBe("remote");
      expect(formatDriftReport(report)).toMatch(/mode: remote/);
    }
  );
});
