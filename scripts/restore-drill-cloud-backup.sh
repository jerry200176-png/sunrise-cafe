#!/usr/bin/env bash
# Restore drill for the encrypted GitHub Actions backup (.github/workflows/backup-db.yml).
# See docs/RUNBOOK_DB_BACKUP.md. NEVER point this at production.
#
# Usage:
#   scripts/restore-drill-cloud-backup.sh <artifact-dir> <age-identity-file>
#
# Target (pick one):
#   default             start a throwaway Docker container (DRILL_IMAGE, default postgres:17)
#   LOCAL_DSN=...       use an existing disposable LOCAL Postgres. Guards: loopback
#                       (127.0.0.1 / localhost / ::1) or Unix-socket hosts only, no
#                       service=/hostaddr=, inherited PG* env vars are cleared,
#                       I_UNDERSTAND_THIS_DROPS_LOCAL_DATA=1 is required, and the run
#                       refuses if the target public schema already has tables.
#                       Client tools on PATH must be >= the dump's pg_dump major (17).
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

# Never inherit libpq settings (PGHOST, PGSERVICE, PGPASSFILE, ...) from the caller's
# shell: they could silently point the drill at a real database.
while IFS= read -r v; do unset "$v"; done < <(compgen -e | grep -E '^PG' || true)

command -v age >/dev/null || { echo "ERROR: age not installed" >&2; exit 2; }

# Validate LOCAL_DSN before decrypting anything.
check_local_dsn() {
  local dsn="$1" rest authority hostport host query param val
  if [ "${I_UNDERSTAND_THIS_DROPS_LOCAL_DATA:-}" != "1" ]; then
    echo "ERROR: LOCAL_DSN mode runs DROP SCHEMA public CASCADE on the target." >&2
    echo "       Set I_UNDERSTAND_THIS_DROPS_LOCAL_DATA=1 for a disposable local DB." >&2
    return 7
  fi
  case "$dsn" in
    postgres://*|postgresql://*) ;;
    *) echo "ERROR: LOCAL_DSN must be a postgresql:// URL" >&2; return 7 ;;
  esac
  if printf '%s' "$dsn" | grep -Eqi '(^|[?&])(service|hostaddr)='; then
    echo "ERROR: LOCAL_DSN must not use service= or hostaddr=" >&2
    return 7
  fi
  rest="${dsn#*://}"
  authority="${rest%%[/?]*}"
  hostport="${authority##*@}"
  case "$hostport" in
    \[*\]*) host="${hostport%%]*}]" ;;
    *) host="${hostport%%:*}" ;;
  esac
  case "$host" in
    ""|127.0.0.1|localhost|"[::1]") ;;
    *) echo "ERROR: LOCAL_DSN host must be loopback (127.0.0.1, localhost, ::1) or a Unix socket" >&2; return 7 ;;
  esac
  query=""
  case "$rest" in *\?*) query="${rest#*\?}" ;; esac
  local IFS='&'
  for param in $query; do
    case "$param" in
      host=*)
        val="${param#host=}"
        val="${val//%2F//}"; val="${val//%2f//}"
        case "$val" in
          /*|127.0.0.1|localhost|::1|"[::1]") ;;
          *) echo "ERROR: LOCAL_DSN host= must be loopback or a Unix socket path" >&2; return 7 ;;
        esac ;;
    esac
  done
  return 0
}
if [ -n "${LOCAL_DSN:-}" ]; then
  check_local_dsn "$LOCAL_DSN" || exit 7
fi

work="$(mktemp -d)"
container=""
cleanup() {
  if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
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

# sql_script: SQL on stdin.  q: one -c query; NEVER reads stdin (safe inside loops).
if [ -n "${LOCAL_DSN:-}" ]; then
  sql_script() { psql "$LOCAL_DSN" -X -q -v ON_ERROR_STOP=1; }
  q() { psql "$LOCAL_DSN" -X -q -v ON_ERROR_STOP=1 -At -c "$1" </dev/null; }
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
  sleep "${DRILL_READY_SLEEP:-2}"
  sql_script() { docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1; }
  q() { docker exec "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -At -c "$1" </dev/null; }
  restore() { docker exec -i "$container" pg_restore -U postgres -d postgres "$@" < "$work/backup.dump"; }
  toc() { docker exec -i "$container" pg_restore --list < "$work/backup.dump"; }
fi

existing="$(q "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [ "$existing" != "0" ]; then
  echo "ERROR: target public schema already has $existing table(s); refusing to DROP it. Use an empty disposable DB." >&2
  exit 7
fi

echo "== 2. pre-create Supabase roles and extensions"
sql_script <<'SQL'
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
while IFS=$'\t' read -r kind name schema <&3; do
  [ "$kind" = "extension" ] || continue
  case "$name" in plpgsql|btree_gist) continue ;; esac
  if ! q "CREATE SCHEMA IF NOT EXISTS \"$schema\"; CREATE EXTENSION IF NOT EXISTS \"$name\" WITH SCHEMA \"$schema\";" >/dev/null 2>&1; then
    echo "WARN: extension $name not available in the drill image (Supabase-specific); skipped"
  fi
done 3< "$work/meta.tsv"
sql_script <<'SQL'
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = public, extensions', current_database());
END $$;
SQL
# The dump contains CREATE SCHEMA public.
q "DROP SCHEMA public CASCADE;" >/dev/null

echo "== 3. pg_restore --exit-on-error"
restore --exit-on-error --no-owner --no-privileges

echo "== 4. invariants"
fail=0
has_excl="$(q "SELECT count(*) FROM pg_constraint WHERE conname = 'reservations_no_overlap_excl'")"
[ "$has_excl" = "1" ] || { echo "FAIL: reservations_no_overlap_excl missing"; fail=1; }
rls="$(q "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reservations'::regclass")"
[ "$rls" = "t" ] || { echo "FAIL: RLS not enabled on reservations"; fail=1; }
want_pol="$(toc | grep -c ' POLICY public ' || true)"
got_pol="$(q "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")"
[ "$want_pol" = "$got_pol" ] || { echo "FAIL: policies dump=$want_pol restored=$got_pol"; fail=1; }
echo "constraint=$has_excl rls=$rls policies=$got_pol/$want_pol"

echo "== 5. row counts"
expected_tables="$(grep -c . "$work/rowcounts.tsv" || true)"
checked=0
while IFS=$'\t' read -r t n <&3; do
  [ -n "$t" ] || continue
  got="$(q "SELECT count(*) FROM public.\"$t\"")"
  checked=$((checked + 1))
  if [ "$got" != "$n" ]; then echo "FAIL: $t backup=$n restored=$got"; fail=1; fi
done 3< "$work/rowcounts.tsv"
echo "tables checked: $checked/$expected_tables"
if [ "$checked" -ne "$expected_tables" ] || [ "$checked" -lt 1 ]; then
  echo "FAIL: compared $checked of $expected_tables tables"
  fail=1
fi

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
