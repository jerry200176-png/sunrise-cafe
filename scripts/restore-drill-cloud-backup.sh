#!/usr/bin/env bash
# Restore drill for the encrypted GitHub Actions backup (.github/workflows/backup-db.yml).
# See docs/RUNBOOK_DB_BACKUP.md. NEVER point this at production.
#
# Usage:
#   scripts/restore-drill-cloud-backup.sh <artifact-dir> <age-identity-file>
#
# Target (pick one):
#   default             start a throwaway Docker container (DRILL_IMAGE, default postgres:17)
#   LOCAL_DSN=...       use an existing disposable local Postgres (client tools on PATH
#                       must be >= the dump's pg_dump major, i.e. 17)
#
# Pass criteria (all required):
#   1. SHA256SUMS verifies
#   2. pg_restore --exit-on-error succeeds (after pre-creating roles + extensions)
#   3. constraint reservations_no_overlap_excl exists
#   4. RLS is enabled on reservations and the restored policy count equals the dump's
#   5. every table's row count equals the encrypted rowcounts.tsv
set -euo pipefail

ARTIFACT_DIR="${1:?usage: $0 <artifact-dir> <age-identity-file>}"
IDENTITY="${2:?usage: $0 <artifact-dir> <age-identity-file>}"
DRILL_IMAGE="${DRILL_IMAGE:-postgres:17}"

command -v age >/dev/null || { echo "ERROR: age not installed" >&2; exit 2; }

work="$(mktemp -d)"
container=""
cleanup() {
  [ -n "$container" ] && docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "== 1. checksum"
(cd "$ARTIFACT_DIR" && sha256sum -c SHA256SUMS)

dump_age="$(find "$ARTIFACT_DIR" -maxdepth 1 -name '*.dump.age' | sort | tail -1)"
[ -n "$dump_age" ] || { echo "ERROR: no *.dump.age in $ARTIFACT_DIR" >&2; exit 2; }
base="${dump_age%.dump.age}"
age -d -i "$IDENTITY" -o "$work/backup.dump" "$dump_age"
age -d -i "$IDENTITY" -o "$work/rowcounts.tsv" "${base}.rowcounts.tsv.age"
if [ -f "${base}.meta.tsv.age" ]; then
  age -d -i "$IDENTITY" -o "$work/meta.tsv" "${base}.meta.tsv.age"
else
  : > "$work/meta.tsv"
fi

if [ -n "${LOCAL_DSN:-}" ]; then
  if echo "$LOCAL_DSN" | grep -Eqi 'supabase\.(co|com)|pooler\.supabase|amazonaws\.com'; then
    echo "ERROR: LOCAL_DSN looks like a hosted/production endpoint — use a disposable local DB" >&2
    exit 7
  fi
  sql() { psql "$LOCAL_DSN" -X -q -v ON_ERROR_STOP=1 "$@"; }
  restore() { pg_restore -d "$LOCAL_DSN" "$@" < "$work/backup.dump"; }
  toc() { pg_restore --list < "$work/backup.dump"; }
else
  command -v docker >/dev/null || { echo "ERROR: docker not installed (or set LOCAL_DSN)" >&2; exit 2; }
  container="drill-pg-$$"
  docker run -d --name "$container" -e POSTGRES_PASSWORD=drill "$DRILL_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  sleep 2
  sql() { docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
  restore() { docker exec -i "$container" pg_restore -U postgres -d postgres "$@" < "$work/backup.dump"; }
  toc() { docker exec -i "$container" pg_restore --list < "$work/backup.dump"; }
fi

echo "== 2. pre-create Supabase roles and extensions"
sql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
-- Required by reservations_no_overlap_excl (supabase/migration-reservations-no-overlap.sql).
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SQL
# Other extensions recorded at backup time; Supabase-only ones are skipped with a warning.
while IFS=$'\t' read -r kind name schema; do
  [ "$kind" = "extension" ] || continue
  case "$name" in plpgsql|btree_gist) continue ;; esac
  if ! sql -c "CREATE SCHEMA IF NOT EXISTS \"$schema\"; CREATE EXTENSION IF NOT EXISTS \"$name\" WITH SCHEMA \"$schema\";" >/dev/null 2>&1; then
    echo "WARN: extension $name not available in the drill image (Supabase-specific); skipped"
  fi
done < "$work/meta.tsv"
sql <<'SQL'
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = public, extensions', current_database());
END $$;
SQL
# The dump contains CREATE SCHEMA public.
sql -c "DROP SCHEMA public CASCADE;"

echo "== 3. pg_restore --exit-on-error"
restore --exit-on-error --no-owner --no-privileges

echo "== 4. invariants"
fail=0
has_excl="$(sql -At -c "SELECT count(*) FROM pg_constraint WHERE conname = 'reservations_no_overlap_excl'")"
[ "$has_excl" = "1" ] || { echo "FAIL: reservations_no_overlap_excl missing"; fail=1; }
rls="$(sql -At -c "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reservations'::regclass")"
[ "$rls" = "t" ] || { echo "FAIL: RLS not enabled on reservations"; fail=1; }
want_pol="$(toc | grep -c ' POLICY public ' || true)"
got_pol="$(sql -At -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")"
[ "$want_pol" = "$got_pol" ] || { echo "FAIL: policies dump=$want_pol restored=$got_pol"; fail=1; }
echo "constraint=$has_excl rls=$rls policies=$got_pol/$want_pol"

echo "== 5. row counts"
while IFS=$'\t' read -r t n; do
  got="$(sql -At -c "SELECT count(*) FROM public.\"$t\"")"
  if [ "$got" != "$n" ]; then echo "FAIL: $t backup=$n restored=$got"; fail=1; fi
done < "$work/rowcounts.tsv"
echo "tables checked: $(wc -l < "$work/rowcounts.tsv")"

pubs="$(awk -F'\t' '$1=="publication"{print $2"\t"$3}' "$work/meta.tsv")"
if [ -n "$pubs" ]; then
  echo "== Realtime publication (NOT restored; recreate on a real Supabase recovery):"
  while IFS=$'\t' read -r pub tbl; do
    echo "  ALTER PUBLICATION $pub ADD TABLE $tbl;"
  done <<< "$pubs"
fi

if [ "$fail" -ne 0 ]; then
  echo "DRILL_RESULT=fail"
  exit 1
fi
echo "DRILL_RESULT=pass"
