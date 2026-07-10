import { describe, expect, it } from "vitest";
import {
  compareSchemaMigrations,
  getExpectedMigrations,
  buildDbHealth,
} from "./schema-governance";

describe("schema-governance", () => {
  it("loads expected migrations from manifest", () => {
    const list = getExpectedMigrations();
    expect(list.length).toBeGreaterThan(25);
    expect(list[0]).toBe("migration-schema-versions.sql");
    expect(list).toContain("migration-phase6-scale-indexes.sql");
  });

  it("detects pending migrations", () => {
    const report = compareSchemaMigrations(["migration-schema-versions.sql"]);
    expect(report.drift).toBe(true);
    expect(report.pending.length).toBeGreaterThan(0);
  });

  it("detects no drift when all applied", () => {
    const expected = getExpectedMigrations();
    const report = compareSchemaMigrations(expected);
    expect(report.drift).toBe(false);
    expect(report.pending).toHaveLength(0);
  });

  it("warns on high analytics volume", () => {
    const health = buildDbHealth({ analytics_events_count: 1_500_000, reservations_count: 1000 });
    expect(health.warnings.length).toBeGreaterThan(0);
  });
});
