import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_SHA256,
  VERSION,
  applyReservationSettlements,
  assertApprovedSql,
  assertRecoveryPoint,
  inApprovedWindow,
  migrationBody,
} from "../../scripts/apply-migration-reservation-settlements.mjs";

const root = process.cwd();
const source = readFileSync(join(root, "supabase/migration-reservation-settlements.sql"), "utf8");
const plan = JSON.parse(readFileSync(join(root, "scripts/production-migration-plan.json"), "utf8")) as {
  entries: Array<{ version?: string; runner?: string; phase?: string; sql_class?: string; approval?: string }>;
};
const inWindow = new Date("2026-10-21T16:00:00Z"); // 台北 00:00

function fakeSql(ledger: boolean) {
  let began = false;
  const sql = Object.assign(
    async (strings: TemplateStringsArray) =>
      strings.join("").includes("schema_migrations") && ledger ? [{ "?column?": 1 }] : [],
    { begin: async () => { began = true; }, array: (values: unknown[]) => values }
  );
  return { sql, began: () => began };
}

function backupDir(manifest: Record<string, unknown>, withArtifact = true) {
  const dir = mkdtempSync(join(tmpdir(), "settle-backup-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  if (withArtifact) writeFileSync(join(dir, `sunrise-cafe_postdeploy_${manifest.created_at_utc}.dump.age`), "ciphertext");
  return dir;
}

const goodManifest = {
  label: "postdeploy",
  created_at_utc: "20261021T155500Z",
  bytes: 123456,
  sha256: "a".repeat(64),
  tables_with_data: 40,
  encrypted: true,
  schema: "public",
  format: "pg_dump custom",
};

describe("reservation settlements migration (Founder F1, 2026-10-21)", () => {
  it("runs only the approved bytes", () => {
    expect(() => assertApprovedSql(source)).not.toThrow();
    expect(APPROVED_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertApprovedSql(source.replace("no_show", "no-show"))).toThrow(/Founder-approved/);
  });

  it("extracts the body between the top-level BEGIN/COMMIT, ignoring the commented rollback", () => {
    const body = migrationBody(source);
    expect(body.startsWith("-- ---")).toBe(true);
    expect(body).toContain("CREATE TABLE IF NOT EXISTS reservation_settlements");
    expect(body).toContain("ADD CONSTRAINT reservations_no_overlap_active_excl");
    expect(body).toContain("DROP CONSTRAINT IF EXISTS reservations_no_overlap_excl");
    expect(body).toContain(`VALUES ('${VERSION}'`);
    expect(body).not.toMatch(/^BEGIN;|COMMIT;\s*$/);
    expect(body).not.toContain("DROP TABLE"); // rollback block stays out
    expect(() => migrationBody("SELECT 1;\nBEGIN;\nSELECT 2;\nCOMMIT;\n")).toThrow(/wrapper changed/);
    expect(() => migrationBody("BEGIN;\nSELECT 2;\n")).toThrow(/wrapper changed/);
  });

  it("allows only UTC 15:30-18:30 (台北 23:30-02:30), clear of every cron hour", () => {
    expect(inApprovedWindow(new Date("2026-10-21T15:29:59Z"))).toBe(false);
    expect(inApprovedWindow(new Date("2026-10-21T15:30:00Z"))).toBe(true);
    expect(inApprovedWindow(new Date("2026-10-21T18:29:00Z"))).toBe(true);
    expect(inApprovedWindow(new Date("2026-10-21T18:30:00Z"))).toBe(false);
    for (const hour of ["01", "07", "12", "13", "19"]) {
      expect(inApprovedWindow(new Date(`2026-10-21T${hour}:10:00Z`))).toBe(false);
    }
  });

  it("is postdeploy, founder_approved with an approval reference, and the last postdeploy runner", () => {
    const entry = plan.entries.find((e) => e.version === VERSION);
    expect(entry?.runner).toBe("scripts/apply-migration-reservation-settlements.mjs");
    expect(entry?.phase).toBe("postdeploy");
    expect(entry?.sql_class).toBe("founder_approved");
    expect(entry?.approval).toMatch(/2026-10-21/);
    const postdeploy = plan.entries.filter((e) => e.phase === "postdeploy");
    expect(postdeploy.at(-1)?.version).toBe(VERSION);
  });

  it("defers outside the window without touching the database or the backup gate", async () => {
    const { sql, began } = fakeSql(false);
    const result = await applyReservationSettlements(sql as never, {
      now: new Date("2026-10-21T04:00:00Z"),
      recoveryPoint: () => { throw new Error("must not be called"); },
    });
    expect(result.status).toBe("deferred_outside_window");
    expect(began()).toBe(false);
  });

  it("refuses to migrate in-window without a recovery point", async () => {
    const { sql, began } = fakeSql(false);
    await expect(
      applyReservationSettlements(sql as never, { now: inWindow, recoveryPoint: () => assertRecoveryPoint({ env: {}, now: inWindow }) })
    ).rejects.toThrow(/No pre-migration backup manifest/);
    expect(began()).toBe(false);
  });

  it("already applied: verifies objects at any hour and fails closed when they are missing", async () => {
    const { sql, began } = fakeSql(true);
    await expect(
      applyReservationSettlements(sql as never, { now: new Date("2026-10-21T04:00:00Z") })
    ).rejects.toThrow(/settlement tables missing/);
    expect(began()).toBe(false);
  });

  it("accepts only a fresh, encrypted, on-disk backup from this phase", () => {
    const now = new Date("2026-10-21T16:00:00Z");
    const good = backupDir(goodManifest);
    expect(assertRecoveryPoint({ env: { BACKUP_OUT_DIR: good, BACKUP_ARTIFACT_ID: "4242" }, now })).toEqual({
      backup_sha256: "a".repeat(64),
      backup_bytes: 123456,
      backup_created_at_utc: "20261021T155500Z",
      backup_artifact_id: "4242",
    });
    // backup -> upload -> confirm: an on-disk ciphertext whose upload was not confirmed is refused
    expect(() => assertRecoveryPoint({ env: { BACKUP_OUT_DIR: good }, now })).toThrow(/upload not confirmed/);
    expect(() => assertRecoveryPoint({ env: { BACKUP_OUT_DIR: good, BACKUP_ARTIFACT_ID: "" }, now })).toThrow(/upload not confirmed/);
    const runnerTemp = mkdtempSync(join(tmpdir(), "settle-rt-"));
    expect(() => assertRecoveryPoint({ env: { RUNNER_TEMP: runnerTemp }, now })).toThrow(/No pre-migration backup manifest/);
    const cases: Array<[Record<string, unknown>, boolean, RegExp]> = [
      [{ ...goodManifest, encrypted: false }, false, /not encrypted/],
      [goodManifest, false, /encrypted dump file missing/],
      [{ ...goodManifest, created_at_utc: "20261021T150000Z" }, true, /stale/],
      [{ ...goodManifest, label: "predeploy" }, true, /label/],
      [{ ...goodManifest, bytes: 10 }, true, /too small/],
      [{ ...goodManifest, sha256: "" }, true, /sha256/],
    ];
    for (const [manifest, artifact, error] of cases) {
      expect(() =>
        assertRecoveryPoint({ env: { BACKUP_OUT_DIR: backupDir(manifest, artifact), BACKUP_ARTIFACT_ID: "4242" }, now })
      ).toThrow(error);
    }
  });
});
