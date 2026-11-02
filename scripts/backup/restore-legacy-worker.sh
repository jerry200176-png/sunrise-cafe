#!/usr/bin/env bash
# Internal worker: descriptors were securely opened by secure-open-inputs.py.
set -euo pipefail
set +x
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
expected_digest="${BACKUP_DRILL_EXPECTED_DIGEST:?}"
zip_path="/proc/self/fd/${BACKUP_ZIP_FD:?}"
identity_path="/proc/self/fd/${BACKUP_IDENTITY_FD:?}"
[[ "$expected_digest" =~ ^sha256:([a-f0-9]{64})$ ]] || { echo 'Trusted ZIP digest missing or malformed.' >&2; exit 1; }
expected_sha="${BASH_REMATCH[1]}"
work="$(mktemp -d /tmp/sunrise-legacy-drill.XXXXXX)"
owner="${work##*.}"
container="sunrise-legacy-drill-$owner"
created=false
docker_bin="$(command -v docker)"
[[ "$docker_bin" == /* && -x "$docker_bin" ]] || { echo 'Local Docker CLI unavailable.' >&2; exit 1; }
docker_config="$work/docker-config"
mkdir "$docker_config"
# Ignore DOCKER_HOST, DOCKER_CONTEXT, user config and TLS overrides. This is a
# fixed local Unix socket; the operator must still trust the host and daemon.
local_docker() (
  # The Docker client never needs the open ZIP or private-identity descriptors.
  exec {BACKUP_ZIP_FD}<&-
  exec {BACKUP_IDENTITY_FD}<&-
  env -i "$docker_bin" --config "$docker_config" --host unix:///var/run/docker.sock "$@"
)
cleanup() {
  if [[ "$created" == true ]]; then
    inspected="$(local_docker inspect "$container" --format '{{.Id}}|{{index .Config.Labels "sunrise.local-drill-owner"}}' 2>/dev/null || true)"
    if [[ "$inspected" =~ ^([a-f0-9]{64})\|([[:alnum:]]+)$ && "${BASH_REMATCH[2]}" == "$owner" ]]; then
      local_docker stop -t 0 "${BASH_REMATCH[1]}" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "$work" == /tmp/sunrise-legacy-drill.* ]]; then rm -r -- "$work"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ -S /var/run/docker.sock && ! -L /var/run/docker.sock && "$(stat -Lc '%u' /var/run/docker.sock)" == 0 ]] || {
  echo 'A root-owned local Docker socket is unavailable.' >&2; exit 1;
}
if ! printf '%s' "$zip_path" | python3 -c '
import os, shutil, sys
path = sys.stdin.read()
size = os.stat(path).st_size
available = shutil.disk_usage(sys.argv[1]).free
if size <= 0 or size > 16 * 1024 ** 3 or size + 64 * 1024 ** 2 > available:
    raise SystemExit(1)
' "$work" 2>/dev/null; then
  echo 'ZIP exceeds the safety limit or available temporary space.' >&2; exit 1
fi
if ! cp -- "$zip_path" "$work/input.zip" 2>/dev/null; then
  echo 'Unable to read the local encrypted artifact.' >&2; exit 1
fi
actual_sha="$(sha256sum "$work/input.zip" | cut -d ' ' -f 1)"
[[ "$actual_sha" == "$expected_sha" ]] || { echo 'ZIP digest mismatch; stopping.' >&2; exit 1; }
mkdir "$work/extracted"
python3 "$script_dir/extract-legacy-artifact.py" "$work/input.zip" "$work/extracted"
manifest="$work/extracted/manifest.json"
ciphertext="$work/extracted/backup.dump.age"
# Hash and count a first streaming decryption; plaintext never goes to a host file.
if ! actual="$(age -d -i "$identity_path" "$ciphertext" 2>/dev/null | python3 -c '
import hashlib, sys
h = hashlib.sha256(); size = 0
while chunk := sys.stdin.buffer.read(1024 * 1024):
    size += len(chunk); h.update(chunk)
print(size, h.hexdigest())')"; then
  echo 'Decryption failed; stopping.' >&2; exit 1
fi
expected="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["bytes"],d["sha256"])' "$manifest")"
[[ "$actual" == "$expected" ]] || { echo 'Decrypted dump does not match manifest.' >&2; exit 1; }
# Refuse an existing name and pull nothing. tmpfs /tmp holds any sanitized restore log.
if local_docker inspect "$container" >/dev/null 2>&1; then echo 'Fixture container name already exists.' >&2; exit 1; fi
created=true
local_docker run -d --rm --pull=never --network none --log-driver=none --read-only --tmpfs /var/lib/postgresql/data:rw,exec,size=4g \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --tmpfs /var/run/postgresql:rw,nosuid,size=16m \
  --label "sunrise.local-drill-owner=$owner" --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture postgres:17-alpine >/dev/null
# Refuse restore if the effective Docker runtime configuration is less isolated.
isolation="$(local_docker inspect "$container" --format '{{.HostConfig.NetworkMode}}|{{.HostConfig.LogConfig.Type}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Privileged}}|{{len .Mounts}}|{{len .HostConfig.Mounts}}|{{len .HostConfig.VolumesFrom}}|{{len .HostConfig.Devices}}|{{len .HostConfig.Binds}}|{{len .HostConfig.PortBindings}}|{{index .HostConfig.Tmpfs "/var/lib/postgresql/data"}}|{{index .HostConfig.Tmpfs "/tmp"}}|{{index .HostConfig.Tmpfs "/var/run/postgresql"}}')"
[[ "$isolation" == 'none|none|true|false|0|0|0|0|0|0|rw,exec,size=4g|rw,noexec,nosuid,size=64m|rw,nosuid,size=16m' ]] || {
  echo 'Container isolation or logging configuration is unexpected.' >&2; exit 1;
}
ready=false
for attempt in $(seq 1 30); do
  # pg_isready alone can succeed while the image's initial setup database is starting.
  if local_docker exec "$container" psql -X -At -U postgres -d fixture -c 'SELECT 1' >/dev/null 2>&1; then
    sleep 1
    if local_docker exec "$container" psql -X -At -U postgres -d fixture -c 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Isolated restore database unavailable.' >&2; exit 1; }
# Fixed no-login roles are restore stubs only, created in this network-isolated throwaway container.
local_docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture >/dev/null 2>&1 <<'SQL'
CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE supabase_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE backup_ro NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DROP SCHEMA public CASCADE;
SQL
# A public-only pg_dump may reference btree_gist without containing its EXTENSION
# entry. Restore the archive's own public schema first (including its owner),
# install the image's extension in that schema, then restore every remaining TOC
# entry in its original order. All intermediate lists and logs stay in tmpfs.
if ! age -d -i "$identity_path" "$ciphertext" 2>/dev/null | local_docker exec -i "$container" sh -c \
  'pg_restore --list > /tmp/restore-full.toc 2>/tmp/restore.log'; then
  echo 'Isolated archive listing failed.' >&2; exit 1
fi
if ! local_docker exec "$container" sh -c '
  set -eu
  pattern="^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public "
  matches="$(awk -v p="$pattern" "\$0 ~ p {n++} END {print n+0}" /tmp/restore-full.toc)"
  [ "$matches" = 1 ]
  awk -v p="$pattern" "\$0 ~ p {print}" /tmp/restore-full.toc > /tmp/restore-schema.toc
  awk -v p="$pattern" "\$0 !~ p {print}" /tmp/restore-full.toc > /tmp/restore-remainder.toc
' >/dev/null 2>&1; then
  echo 'Isolated archive schema selection failed.' >&2; exit 1
fi
if ! age -d -i "$identity_path" "$ciphertext" 2>/dev/null | local_docker exec -i "$container" sh -c \
  'pg_restore -U postgres -d fixture --use-list=/tmp/restore-schema.toc --exit-on-error --single-transaction > /tmp/restore.log 2>&1'; then
  echo 'Isolated public schema restore failed.' >&2; exit 1
fi
if ! local_docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture >/dev/null 2>&1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
    RAISE EXCEPTION 'required extension unavailable';
  END IF;
END $$;
CREATE EXTENSION btree_gist WITH SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    JOIN pg_opclass c ON c.opcnamespace = n.oid
    JOIN pg_am am ON am.oid = c.opcmethod
    WHERE e.extname = 'btree_gist' AND n.nspname = 'public'
      AND c.opcname = 'gist_uuid_ops' AND c.opcintype = 'uuid'::regtype AND am.amname = 'gist'
  ) THEN RAISE EXCEPTION 'required extension placement or operator class unavailable'; END IF;
END $$;
SQL
then
  echo 'Isolated btree_gist preparation failed.' >&2; exit 1
fi
if ! age -d -i "$identity_path" "$ciphertext" 2>/dev/null | local_docker exec -i "$container" sh -c \
  'pg_restore -U postgres -d fixture --use-list=/tmp/restore-remainder.toc --exit-on-error --single-transaction > /tmp/restore.log 2>&1'; then
  echo 'Isolated restore failed; inspect prerequisites without sharing unredacted data.' >&2; exit 1
fi
# Minimal shape check, not a comparison against the source or complete Supabase recovery.
if ! local_docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture -c \
  "DO \$\$ BEGIN IF to_regclass('public.reservations') IS NULL THEN RAISE EXCEPTION 'required table missing'; END IF; END \$\$;" >/dev/null 2>&1; then
  echo 'Required reservations table missing after restore.' >&2; exit 1
fi
echo 'Isolated dump decryption, SHA-256 check and PostgreSQL restore completed.'
echo 'This does not verify source identity, row-by-row completeness, Auth, Storage or full Supabase recovery.'
echo 'This alone does not clear any production release hold.'
