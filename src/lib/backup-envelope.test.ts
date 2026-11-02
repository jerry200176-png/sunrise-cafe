import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessFreshness, chooseRecipient, makeManifest, makeReceipt, verifyEnvelope, verifyReceipt } from "../../scripts/backup/envelope.mjs";

const temporaryDirectories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sunrise-envelope-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "backup.tar.age");
  // A fake age header exercises local validation, not encryption or recoverability.
  await writeFile(path, Buffer.from("age-encryption.org/v1\nsynthetic ciphertext"));
  return { directory, path };
}
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

describe("offline encrypted backup envelope", () => {
  it("accepts only the canonical public recipient and rejects disagreement without revealing it", () => {
    const recipient = `age1${"q".repeat(58)}`;
    expect(chooseRecipient({ variable: recipient, legacySecret: recipient, manualInput: "" })).toBe(recipient);
    expect(() => chooseRecipient({ variable: recipient, legacySecret: `age1${"p".repeat(58)}` })).toThrow("recipient sources differ");
    expect(() => chooseRecipient({ legacySecret: recipient })).toThrow("invalid or missing canonical recipient");
    expect(() => chooseRecipient({ variable: `${recipient}\n` })).toThrow("invalid or missing canonical recipient");
  });

  it("validates old ciphertext without treating retention as a freshness or deletion deadline", async () => {
    const { path } = await fixture();
    const manifest = await makeManifest({ purpose: "scheduled", createdAt: "2026-01-01T00:00:00.000Z", ciphertextPath: path });
    expect(manifest.retention_days).toBe(35);
    expect(await verifyEnvelope({ manifest, ciphertextPath: path, now: new Date("2026-01-02T00:00:00Z") })).toBe(true);
    const later = new Date("2026-02-05T00:00:00Z");
    expect(await verifyEnvelope({ manifest, ciphertextPath: path, now: later })).toBe(true);
    expect(assessFreshness({ manifest, now: later, maxAgeMs: 86400000 })).toBe("stale");
    expect(assessFreshness({ manifest, now: new Date("2026-01-01T12:00:00Z"), maxAgeMs: 86400000 })).toBe("fresh");
    expect(() => assessFreshness({ manifest, now: later, maxAgeMs: 0 })).toThrow("invalid freshness inputs");
    await expect(verifyEnvelope({ manifest, ciphertextPath: path, now: new Date("2025-12-31T23:50:00Z") })).rejects.toThrow("in the future");
    expect(await verifyEnvelope({ manifest: { ...manifest, retention_days: 90 }, ciphertextPath: path, now: later })).toBe(true);
    await expect(verifyEnvelope({ manifest: { ...manifest, retention_days: 34 }, ciphertextPath: path })).rejects.toThrow("invalid backup manifest");
    await expect(verifyEnvelope({ manifest: { ...manifest, customer_data: "not allowed" }, ciphertextPath: path })).rejects.toThrow("invalid backup manifest");
    await writeFile(path, "age-encryption.org/v1\nmodified ciphertext!");
    await expect(verifyEnvelope({ manifest, ciphertextPath: path, now: new Date("2026-01-02T00:00:00Z") })).rejects.toThrow("ciphertext does not match");
  });

  it("rejects invalid headers and symlinks; does not confuse a listing with ciphertext", async () => {
    const { directory, path } = await fixture();
    const link = join(directory, "link.age");
    await symlink(path, link);
    await expect(makeManifest({ purpose: "drill", createdAt: "2026-01-01T00:00:00.000Z", ciphertextPath: link })).rejects.toThrow();
    await writeFile(path, "plaintext dump or pg_restore list");
    await expect(makeManifest({ purpose: "drill", createdAt: "2026-01-01T00:00:00.000Z", ciphertextPath: path })).rejects.toThrow("invalid age header");
  });

  it("binds the manifest, uploaded ZIP digest and expected artifact ID independently", async () => {
    const { path } = await fixture();
    const manifest = await makeManifest({ purpose: "migration", createdAt: "2026-01-01T00:00:00.000Z", ciphertextPath: path });
    expect(manifest.retention_days).toBe(3);
    const bytes = Buffer.from(JSON.stringify(manifest));
    const zipDigest = "a".repeat(64);
    const receipt = makeReceipt({ artifactId: "456", archiveSha256: zipDigest, manifestBytes: bytes });
    expect(verifyReceipt({ receipt, manifestBytes: bytes, observedArchiveSha256: zipDigest, expectedArtifactId: "456" })).toBe(true);
    expect(() => verifyReceipt({ receipt, manifestBytes: bytes, observedArchiveSha256: "b".repeat(64), expectedArtifactId: "456" })).toThrow("mismatch");
    expect(() => verifyReceipt({ receipt, manifestBytes: bytes, observedArchiveSha256: zipDigest, expectedArtifactId: "457" })).toThrow("invalid upload receipt");
    expect(() => verifyReceipt({ receipt, manifestBytes: Buffer.from(`${bytes} `), observedArchiveSha256: zipDigest, expectedArtifactId: "456" })).toThrow("mismatch");
    expect((await readFile(path)).length).toBeGreaterThan(0);
  });
});
