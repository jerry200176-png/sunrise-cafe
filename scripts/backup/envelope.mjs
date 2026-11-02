/**
 * Offline validation for the proposed v1 encrypted-backup envelope.
 * This module does not read credentials, connect to databases, upload artifacts,
 * decrypt backups or authorize a migration. See docs/plans/2026-11-backup-envelope-contract.md.
 */
import { constants, createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';

export const RETENTION_DAYS = Object.freeze({ scheduled: 35, drill: 14, migration: 3 });
const AGE_HEADER = Buffer.from('age-encryption.org/v1\n');
const SHA256 = /^[a-f0-9]{64}$/;
const AGE_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
const FILENAME = 'backup.tar.age';

function fail(message) { throw new Error(message); }
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(object, keys) {
  return plainObject(object) && Object.keys(object).length === keys.length
    && keys.every((key) => Object.hasOwn(object, key));
}
function safeEqualHex(a, b) {
  return SHA256.test(a) && SHA256.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function validTime(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * A public recipient is not a credential; age itself must validate its checksum.
 * @param {{ variable?: string, legacySecret?: string, manualInput?: string }} sources
 */
export function chooseRecipient({ variable = undefined, legacySecret = undefined, manualInput = undefined } = {}) {
  if (typeof variable !== 'string' || !AGE_RECIPIENT.test(variable)) fail('invalid or missing canonical recipient');
  for (const candidate of [legacySecret, manualInput]) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    if (typeof candidate !== 'string' || candidate !== variable) fail('recipient sources differ');
  }
  return variable;
}

/** Hash an already encrypted regular file with bounded memory, without following a final symlink. */
export async function fingerprintCiphertext(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const initial = await file.stat();
    if (!initial.isFile() || !Number.isSafeInteger(initial.size) || initial.size <= AGE_HEADER.length) {
      fail('invalid ciphertext file');
    }
    const prefix = Buffer.alloc(AGE_HEADER.length);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    if (bytesRead !== prefix.length || !prefix.equals(AGE_HEADER)) fail('invalid age header');
    const hash = createHash('sha256');
    let size = 0;
    const stream = createReadStream(path, { fd: file.fd, autoClose: false, start: 0 });
    for await (const chunk of stream) { size += chunk.length; hash.update(chunk); }
    const final = await file.stat();
    if (size !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs) {
      fail('ciphertext changed during hashing');
    }
    return { size_bytes: size, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}

function checkManifest(manifest) {
  if (!exactKeys(manifest, ['version', 'purpose', 'created_at', 'scope', 'format', 'retention_days', 'ciphertext'])
      || manifest.version !== 1 || !Object.hasOwn(RETENTION_DAYS, manifest.purpose)
      || manifest.scope !== 'public-only' || manifest.format !== 'age-encrypted-tar-v1'
      || !Number.isSafeInteger(manifest.retention_days) || manifest.retention_days < RETENTION_DAYS[manifest.purpose]
      || !validTime(manifest.created_at)
      || !exactKeys(manifest.ciphertext, ['name', 'size_bytes', 'sha256'])
      || manifest.ciphertext.name !== FILENAME || !Number.isSafeInteger(manifest.ciphertext.size_bytes)
      || manifest.ciphertext.size_bytes <= AGE_HEADER.length || typeof manifest.ciphertext.sha256 !== 'string'
      || !SHA256.test(manifest.ciphertext.sha256)) fail('invalid backup manifest');
}

export async function makeManifest({ purpose, createdAt, ciphertextPath, retentionDays = RETENTION_DAYS[purpose] }) {
  if (!Object.hasOwn(RETENTION_DAYS, purpose) || !validTime(createdAt)) fail('invalid purpose or timestamp');
  if (!Number.isSafeInteger(retentionDays) || retentionDays < RETENTION_DAYS[purpose]) fail('invalid retention');
  const file = await fingerprintCiphertext(ciphertextPath);
  return { version: 1, purpose, created_at: createdAt, scope: 'public-only',
    format: 'age-encrypted-tar-v1', retention_days: retentionDays,
    ciphertext: { name: FILENAME, ...file } };
}

/** Checks local bytes against the manifest; does not decrypt, restore, or establish authenticity. */
export async function verifyEnvelope({ manifest, ciphertextPath, now = new Date() }) {
  checkManifest(manifest);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('invalid verification time');
  const ageMs = now.getTime() - Date.parse(manifest.created_at);
  if (ageMs < -300000) fail('manifest timestamp is in the future');
  const actual = await fingerprintCiphertext(ciphertextPath);
  if (actual.size_bytes !== manifest.ciphertext.size_bytes || !safeEqualHex(actual.sha256, manifest.ciphertext.sha256)) {
    fail('ciphertext does not match manifest');
  }
  return true;
}

/** Freshness is independent of integrity, retention, source identity and release approval. */
export function assessFreshness({ manifest, maxAgeMs, now = new Date() }) {
  checkManifest(manifest);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())
      || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) fail('invalid freshness inputs');
  const ageMs = now.getTime() - Date.parse(manifest.created_at);
  if (ageMs < -300000) fail('manifest timestamp is in the future');
  return ageMs < maxAgeMs ? 'fresh' : 'stale';
}

/** The upload receipt is separate because an artifact ID and ZIP digest do not exist before upload. */
export function makeReceipt({ artifactId, archiveSha256, manifestBytes }) {
  if (typeof artifactId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(artifactId)
      || typeof archiveSha256 !== 'string' || !SHA256.test(archiveSha256)
      || !Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0 || manifestBytes.length > 16384) {
    fail('invalid receipt inputs');
  }
  return { version: 1, artifact_id: artifactId, archive_sha256: archiveSha256,
    manifest_sha256: createHash('sha256').update(manifestBytes).digest('hex') };
}

/** Caller must independently hash the downloaded artifact ZIP, not reuse the receipt field. */
export function verifyReceipt({ receipt, manifestBytes, observedArchiveSha256, expectedArtifactId }) {
  if (!exactKeys(receipt, ['version', 'artifact_id', 'archive_sha256', 'manifest_sha256'])
      || receipt.version !== 1 || typeof expectedArtifactId !== 'string' || receipt.artifact_id !== expectedArtifactId
      || typeof receipt.artifact_id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(receipt.artifact_id)
      || typeof receipt.archive_sha256 !== 'string' || typeof receipt.manifest_sha256 !== 'string'
      || typeof observedArchiveSha256 !== 'string' || !Buffer.isBuffer(manifestBytes)
      || manifestBytes.length === 0 || manifestBytes.length > 16384) fail('invalid upload receipt');
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
  if (!safeEqualHex(receipt.archive_sha256, observedArchiveSha256) || !safeEqualHex(receipt.manifest_sha256, manifestHash)) {
    fail('upload receipt mismatch');
  }
  return true;
}
