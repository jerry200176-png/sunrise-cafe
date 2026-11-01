#!/usr/bin/env bash
# Synthetic-only integration check. Never use a real encryption identity here.
# Set AGE_BIN, AGE_KEYGEN_BIN and AGE_PUBLIC_TEST_IDENTITY to local executables
# and the public testdata/example_keys.txt from age v1.2.1, respectively.
# Requires a pre-existing postgres:17-alpine image; does not access any DB URL.
set -euo pipefail
: "${AGE_BIN:?set AGE_BIN to the local age executable}"
: "${AGE_KEYGEN_BIN:?set AGE_KEYGEN_BIN to local age-keygen}"
: "${AGE_PUBLIC_TEST_IDENTITY:?set AGE_PUBLIC_TEST_IDENTITY to the upstream public test identity}"
command -v docker >/dev/null
command -v node >/dev/null
[[ -x "$AGE_BIN" && -x "$AGE_KEYGEN_BIN" && -f "$AGE_PUBLIC_TEST_IDENTITY" ]] || exit 1
# Pin the publicly disclosed test fixture, so a real identity is never used here.
actual_identity_sha="$(sha256sum "$AGE_PUBLIC_TEST_IDENTITY" | cut -d ' ' -f 1)"
[[ "$actual_identity_sha" == aae4728b2967a9f8aeba742beaac8f7f55760392eed0164be641bffa3fac9de9 ]] || {
  echo 'Not the pinned public upstream test identity; refusing to run.' >&2; exit 1;
}
work="$(mktemp -d /tmp/sunrise-envelope-e2e.XXXXXX)"
suffix="${work##*.}"
src="sunrise-envelope-src-$suffix"
dst="sunrise-envelope-dst-$suffix"
src_created=false
dst_created=false
cleanup() {
  if [[ "$src_created" == true ]]; then docker stop -t 0 "$src" >/dev/null 2>&1 || true; fi
  if [[ "$dst_created" == true ]]; then docker stop -t 0 "$dst" >/dev/null 2>&1 || true; fi
  rm -r -- "$work"
}
trap cleanup EXIT
umask 077
# No host port and no network; storage is ephemeral tmpfs, not a mounted host directory.
for container in "$src" "$dst"; do
  if docker inspect "$container" >/dev/null 2>&1; then echo 'fixture container name already exists' >&2; exit 1; fi
  docker run -d --rm --pull=never --network none --tmpfs /var/lib/postgresql/data:rw,exec,size=256m \
    --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture postgres:17-alpine >/dev/null
  if [[ "$container" == "$src" ]]; then src_created=true; else dst_created=true; fi
  ready=false
  for attempt in $(seq 1 30); do
    if docker exec "$container" psql -X -At -U postgres -d fixture -c 'SELECT 1' >/dev/null 2>&1; then
      sleep 1
      if docker exec "$container" psql -X -At -U postgres -d fixture -c 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
    fi
    sleep 1
  done
  [[ "$ready" == true ]] || { echo 'fixture database unavailable' >&2; exit 1; }
done
"$AGE_KEYGEN_BIN" -y "$AGE_PUBLIC_TEST_IDENTITY" > "$work/recipient.txt"
docker exec "$src" psql -X -v ON_ERROR_STOP=1 -U postgres -d fixture -c \
  "CREATE TABLE public.reservations (id integer PRIMARY KEY); CREATE TABLE public.synthetic_rows (id integer PRIMARY KEY, label text NOT NULL); INSERT INTO public.synthetic_rows VALUES (1, 'synthetic'), (2, 'fixture');" >/dev/null
docker exec "$src" pg_dump -U postgres -d fixture --schema=public -Fc > "$work/fixture.dump"
tar -cf "$work/backup.tar" -C "$work" fixture.dump
"$AGE_BIN" -R "$work/recipient.txt" -o "$work/backup.tar.age" "$work/backup.tar"
BACKUP_FIXTURE_FILE="$work/backup.tar.age" node --input-type=module <<'NODE'
import { makeManifest, verifyEnvelope } from './scripts/backup/envelope.mjs';
const ciphertextPath = process.env.BACKUP_FIXTURE_FILE;
const manifest = await makeManifest({ purpose: 'drill', createdAt: new Date().toISOString(), ciphertextPath });
await verifyEnvelope({ manifest, ciphertextPath });
NODE
"$AGE_BIN" -d -i "$AGE_PUBLIC_TEST_IDENTITY" -o "$work/decrypted.tar" "$work/backup.tar.age"
mkdir "$work/restored"
tar -xf "$work/decrypted.tar" -C "$work/restored"
# This is an empty disposable target; no database outside these containers is used.
docker exec "$dst" psql -X -v ON_ERROR_STOP=1 -U postgres -d fixture -c 'DROP SCHEMA public CASCADE' >/dev/null
docker exec -i "$dst" pg_restore -U postgres -d fixture --exit-on-error --single-transaction < "$work/restored/fixture.dump"
[[ "$(docker exec "$dst" psql -X -At -U postgres -d fixture -c 'SELECT count(*) FROM public.synthetic_rows')" == 2 ]]
[[ "$(docker exec "$dst" psql -X -At -U postgres -d fixture -c "SELECT string_agg(id::text || ':' || label, ',' ORDER BY id) FROM public.synthetic_rows")" == '1:synthetic,2:fixture' ]]
cp "$work/backup.tar.age" "$work/damaged.age"
printf X >> "$work/damaged.age"
if "$AGE_BIN" -d -i "$AGE_PUBLIC_TEST_IDENTITY" -o "$work/invalid.tar" "$work/damaged.age" 2>/dev/null; then
  echo 'Unexpected success decrypting altered ciphertext.' >&2; exit 1
fi
# Exercise the *existing legacy format* locally, not a v1 tar envelope or production artifact.
legacy_name='sunrise-cafe_predeploy_20260101T000000Z.dump.age'
"$AGE_BIN" -R "$work/recipient.txt" -o "$work/$legacy_name" "$work/fixture.dump"
LEGACY_WORK="$work" LEGACY_NAME="$legacy_name" python3 - <<'PY'
import hashlib, json, os, pathlib, zipfile
work = pathlib.Path(os.environ['LEGACY_WORK'])
dump = work / 'fixture.dump'
manifest = {'label': 'predeploy', 'created_at_utc': '20260101T000000Z',
            'bytes': dump.stat().st_size, 'sha256': hashlib.sha256(dump.read_bytes()).hexdigest(),
            'tables_with_data': 2, 'encrypted': True, 'schema': 'public', 'format': 'pg_dump custom'}
with zipfile.ZipFile(work / 'legacy.zip', 'w') as archive:
    archive.writestr('manifest.json', json.dumps(manifest))
    archive.write(work / os.environ['LEGACY_NAME'], os.environ['LEGACY_NAME'])
PY
zip_sha="$(sha256sum "$work/legacy.zip" | cut -d ' ' -f 1)"
# Protected paths fail before any open; a validated FD survives a later symlink swap.
BACKUP_FIXTURE_WORK="$work" PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import importlib.util, os, pathlib
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('secure_inputs', 'scripts/backup/secure-open-inputs.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
for forbidden in ('/tmp/.ssh/key', '/tmp/.aws/key', '/tmp/.env-sensitive/key'):
    with patch.object(module.os, 'open', side_effect=AssertionError('protected path was touched')):
        try: module.secure_open(forbidden)
        except SystemExit: pass
        else: raise AssertionError('protected path accepted')
work = pathlib.Path(os.environ['BACKUP_FIXTURE_WORK'])
original, replacement, saved = (work / name for name in ('first', 'second', 'saved'))
original.write_bytes(b'original synthetic'); replacement.write_bytes(b'replacement synthetic')
fd = module.secure_open(str(original))
os.rename(original, saved); os.symlink(replacement, original)
try:
    assert os.read(fd, 100) == b'original synthetic'
    try: module.secure_open(str(original))
    except SystemExit: pass
    else: raise AssertionError('symlink accepted')
finally:
    os.close(fd)
alias = work / 'hardlink'
os.link(saved, alias)
try:
    try: module.secure_open(str(alias))
    except SystemExit: pass
    else: raise AssertionError('multiple-link file accepted')
finally:
    os.unlink(alias)
PY
# A ZIP path traversal is rejected before extraction, regardless of its manifest.
LEGACY_WORK="$work" python3 - <<'PY'
import os, pathlib, zipfile
work = pathlib.Path(os.environ['LEGACY_WORK'])
with zipfile.ZipFile(work / 'bad.zip', 'w') as archive:
    archive.writestr('manifest.json', '{}')
    archive.writestr('../outside.dump.age', 'synthetic')
PY
mkdir "$work/reject"
if python3 scripts/backup/extract-legacy-artifact.py "$work/bad.zip" "$work/reject" >/dev/null 2>&1; then
  echo 'Unexpected acceptance of an unsafe ZIP entry.' >&2; exit 1
fi
# A sparse synthetic file proves an oversized ZIP is rejected before any copy.
truncate -s 17179869185 "$work/oversize.zip"
if printf '%s\n%s\n%s\n' "$work/oversize.zip" "sha256:$(printf '0%.0s' {1..64})" "$AGE_PUBLIC_TEST_IDENTITY" | \
  PATH="$(dirname "$AGE_BIN"):$PATH" bash scripts/backup/restore-legacy-local.sh >"$work/oversize.out" 2>&1; then
  echo 'Unexpected acceptance of an oversized ZIP.' >&2; exit 1
fi
grep -q 'ZIP exceeds the safety limit or available temporary space' "$work/oversize.out"
if printf '%s\n%s\n%s\n' "$work/legacy.zip" "sha256:$(printf '0%.0s' {1..64})" "$AGE_PUBLIC_TEST_IDENTITY" | \
  PATH="$(dirname "$AGE_BIN"):$PATH" bash scripts/backup/restore-legacy-local.sh >/dev/null 2>&1; then
  echo 'Legacy restore unexpectedly accepted an incorrect ZIP digest.' >&2; exit 1
fi
printf '%s\n%s\n%s\n' "$work/legacy.zip" "sha256:$zip_sha" "$AGE_PUBLIC_TEST_IDENTITY" | \
  PATH="$(dirname "$AGE_BIN"):$PATH" DOCKER_HOST='tcp://203.0.113.1:2375' \
  DOCKER_CONTEXT='synthetic-untrusted-remote' DOCKER_TLS_VERIFY=1 DOCKER_CONFIG="$work/nonexistent-docker-config" \
  bash scripts/backup/restore-legacy-local.sh >/dev/null
echo 'Synthetic v1 and legacy age decrypt, corruption rejection and isolated PostgreSQL restore: PASS'
