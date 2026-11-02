import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePhaseBackup } from "../../scripts/run-production-migration-phase.mjs";

const verifyUpload = join(process.cwd(), "scripts/verify-backup-upload.sh");
const digest = "a".repeat(64);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "backup-gate-"));
  const now = new Date("2026-10-31T12:00:00Z");
  const stamp = "20261031T120000Z";
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ label: "predeploy", created_at_utc: stamp,
    bytes: 4096, sha256: "b".repeat(64), tables_with_data: 2, encrypted: true, schema: "public", format: "pg_dump custom" }));
  writeFileSync(join(dir, `sunrise-cafe_predeploy_${stamp}.dump.age`), "synthetic ciphertext");
  return { dir, now };
}

function uploadCheck(id: string, hash: string) {
  return spawnSync("bash", [verifyUpload], { encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test", ARTIFACT_ID: id, ARTIFACT_DIGEST: hash } });
}

describe("backup upload gate", () => {
  it("blocks migration for failed upload, missing artifact id or missing digest", () => {
    const { dir, now } = fixture();
    let ran = false;
    for (const [id, hash] of [["", ""], ["", digest], ["123", ""], ["123", "not-a-digest"]]) {
      expect(uploadCheck(id, hash).status).toBe(1);
      expect(() => { validatePhaseBackup("predeploy", { BACKUP_OUT_DIR: dir, BACKUP_ARTIFACT_ID: id, BACKUP_ARTIFACT_DIGEST: hash }, now); ran = true; }).toThrow();
    }
    expect(ran).toBe(false);
  });

  it("accepts only a fresh phase-matched encrypted backup with uploaded artifact evidence", () => {
    const { dir, now } = fixture();
    const env = { BACKUP_OUT_DIR: dir, BACKUP_ARTIFACT_ID: "123", BACKUP_ARTIFACT_DIGEST: digest };
    expect(uploadCheck("123", digest).status).toBe(0);
    expect(validatePhaseBackup("predeploy", env, now)).toMatchObject({ backup_artifact_id: "123", backup_bytes: 4096 });
    expect(() => validatePhaseBackup("postdeploy", env, now)).toThrow(/label/);
    expect(() => validatePhaseBackup("predeploy", env, new Date("2026-10-31T13:00:00Z"))).toThrow(/stale/);
  });
});
