#!/usr/bin/env bash
# Helpers for .github/workflows/db-backup-restore-drill.yml (CG-011).
#
# Log-safety contract: database tools (psql / pg_dump / pg_restore) never
# write to the Actions log. Their stdout/stderr go to mode-600 files under
# $DRILL_LOG_DIR (default $RUNNER_TEMP/drill-logs), which are never uploaded
# and are shredded by the workflow's always() cleanup step. On failure only a
# fixed stage name, the exit code and an allowlisted SQLSTATE class are
# printed. Error text can carry connection hosts, SQL, COPY context or row
# contents, so it is never echoed.
#
# Source this file; do not execute it.

# Allowlisted SQLSTATE classes (PostgreSQL Appendix A). Anything else -> unknown.
DRILL_SQLSTATE_CLASSES=" 00 01 02 03 08 09 0A 0B 0F 0L 0P 0Z 20 21 22 23 24 25 26 27 28 2B 2D 2F 34 38 39 3B 3D 3F 40 42 44 53 54 55 57 58 72 F0 HV P0 XX "

drill_log_dir() {
  local dir="${DRILL_LOG_DIR:-${RUNNER_TEMP:?RUNNER_TEMP is not set}/drill-logs}"
  (umask 077 && mkdir -p "${dir}")
  chmod 700 "${dir}"
  printf '%s' "${dir}"
}

# drill_sqlstate_class <file>: prints a 2-char allowlisted class or "unknown".
# Only inspects `SEVERITY:  XXXXX` (psql VERBOSITY=sqlstate shape).
drill_sqlstate_class() {
  local file="$1" code cls
  code="$(grep -m1 -oE '(ERROR|FATAL|PANIC): +[0-9A-Z]{5}( |:|$)' "${file}" 2>/dev/null \
    | sed -E 's/^(ERROR|FATAL|PANIC): +([0-9A-Z]{5}).*$/\2/' | head -n1 || true)"
  cls="${code:0:2}"
  if [ -n "${cls}" ] && [[ "${DRILL_SQLSTATE_CLASSES}" == *" ${cls} "* ]]; then
    printf '%s' "${cls}"
  else
    printf 'unknown'
  fi
}

# drill_quiet <stage> <stdout-file|-> <cmd> [args...]
# Runs cmd with stdout -> stdout-file (or <stage>.out when "-") and
# stderr -> <stage>.err, both mode 600. Returns cmd's exit status.
drill_quiet() {
  local stage="$1" out="$2"
  shift 2
  if [[ ! "${stage}" =~ ^[a-z0-9_-]+$ ]]; then
    echo "::error::drill: invalid stage name"
    return 64
  fi
  local dir err rc
  dir="$(drill_log_dir)"
  err="${dir}/${stage}.err"
  [ "${out}" = "-" ] && out="${dir}/${stage}.out"
  (umask 077 && : > "${err}" && : > "${out}")
  chmod 600 "${err}" "${out}"
  rc=0
  "$@" > "${out}" 2> "${err}" || rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "::error::drill stage '${stage}' failed (exit=${rc}, sqlstate_class=$(drill_sqlstate_class "${err}"))"
  fi
  return "${rc}"
}

# drill_counts <stage> <out-file> [conninfo]
# Exact per-table counts for schema public as sorted `table=count` lines.
drill_counts() {
  local stage="$1" out="$2" conn="${3:-}" dir raw rc=0
  dir="$(drill_log_dir)"
  raw="${dir}/${stage}.raw"
  local -a args=(-X -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f "${DRILL_LIB_DIR}/counts.sql")
  if [ -n "${conn}" ]; then args=("${conn}" "${args[@]}"); fi
  drill_quiet "${stage}" "${raw}" psql "${args[@]}" || return $?
  (umask 077 && grep -v '^$' "${raw}" | LC_ALL=C sort > "${out}") || rc=$?
  if [ "${rc}" -gt 1 ]; then echo "::error::drill stage '${stage}' failed (sort)"; return 1; fi
  if [ ! -s "${out}" ]; then
    echo "::error::drill stage '${stage}': no tables found in schema public"
    return 1
  fi
  # Every line must be name=integer; never print an offending line.
  if grep -qvE '^[A-Za-z0-9_$]+=[0-9]+$' "${out}"; then
    echo "::error::drill stage '${stage}': unexpected output shape"
    return 1
  fi
  echo "${stage}: counted $(wc -l < "${out}") tables"
}

# drill_require_tables <counts-file> <table>...: fail closed if any is absent.
# Only names from the caller's fixed list are printed.
drill_require_tables() {
  local file="$1" missing=0 t
  shift
  for t in "$@"; do
    if ! grep -q "^${t}=" "${file}"; then
      echo "::error::required Sunrise table missing: ${t}"
      missing=1
    fi
  done
  return "${missing}"
}

# drill_identity <stage> <out-file> <markers-csv> [conninfo]
# Writes `markers_found=N` = how many of the given schema_migrations
# versions exist. Markers are fixed repo constants, validated before use.
drill_identity() {
  local stage="$1" out="$2" markers="$3" conn="${4:-}" m list="" sql
  local -a arr=()
  IFS=',' read -r -a arr <<< "${markers}"
  if [ "${#arr[@]}" -eq 0 ]; then
    echo "::error::drill: no identity markers"
    return 64
  fi
  for m in "${arr[@]}"; do
    if [[ ! "${m}" =~ ^[0-9]{8}-[a-z0-9-]+$ ]]; then
      echo "::error::drill: invalid identity marker"
      return 64
    fi
    list="${list:+${list},}'${m}'"
  done
  sql="SET default_transaction_read_only = on; SELECT 'markers_found=' || count(*) FROM public.schema_migrations WHERE version IN (${list});"
  local -a args=(-X -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -c "${sql}")
  if [ -n "${conn}" ]; then args=("${conn}" "${args[@]}"); fi
  drill_quiet "${stage}" "${out}" psql "${args[@]}" || return $?
  if ! grep -qxE 'markers_found=[0-9]+' "${out}"; then
    echo "::error::drill stage '${stage}': unexpected output shape"
    return 1
  fi
}

# drill_source_ref_sha256 <conninfo-url>
# Derives the Supabase project ref from a postgres:// URL WITHOUT printing
# the URL, host, user or ref, and prints only sha256(ref). Accepted shapes:
#   postgres[ql]://<user>[:pw]@db.<ref>.supabase.co[:port]/<db>[?params]
#   postgres[ql]://postgres.<ref>[:pw]@<x>.pooler.supabase.com[:port]/<db>[?params]
# Anything else (keyword/value conninfo, multiple hosts, non-Supabase host,
# hostaddr/host/service overrides in the query string or env, user and host
# naming different projects) returns 1 with a fixed message.
drill_source_ref_sha256() {
  local url="$1" rest userinfo hostpart host user query ref="" uref="" href=""
  local -a kv=()
  local pair key
  if [ -n "${PGHOSTADDR:-}" ] || [ -n "${PGSERVICE:-}" ] || [ -n "${PGSERVICEFILE:-}" ]; then
    echo "::error::source identity: PGHOSTADDR/PGSERVICE overrides are not allowed"
    return 1
  fi
  if [[ ! "${url}" =~ ^postgres(ql)?:// ]]; then
    echo "::error::source identity: connection is not a postgres:// URL"
    return 1
  fi
  rest="${url#*://}"
  if [[ "${rest}" != *@* ]]; then
    echo "::error::source identity: connection URL has no user"
    return 1
  fi
  userinfo="${rest%@*}"
  hostpart="${rest##*@}"
  query=""
  if [[ "${hostpart}" == *\?* ]]; then query="${hostpart#*\?}"; fi
  host="${hostpart%%[/?]*}"
  host="${host%:*}"
  user="${userinfo%%:*}"
  if [ -n "${query}" ]; then
    IFS='&' read -r -a kv <<< "${query}"
    for pair in "${kv[@]}"; do
      key="${pair%%=*}"
      case "${key}" in
        sslmode|connect_timeout|application_name) ;;
        *)
          echo "::error::source identity: connection URL has a disallowed parameter"
          return 1
          ;;
      esac
    done
  fi
  if [[ "${host}" =~ ^db\.([a-z0-9]{20})\.supabase\.co$ ]]; then
    href="${BASH_REMATCH[1]}"
  elif [[ ! "${host}" =~ ^[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
    echo "::error::source identity: connection host is not a Supabase project host"
    return 1
  fi
  if [[ "${user}" =~ ^postgres\.([a-z0-9]{20})$ ]]; then
    uref="${BASH_REMATCH[1]}"
  fi
  if [ -n "${href}" ] && [ -n "${uref}" ] && [ "${href}" != "${uref}" ]; then
    echo "::error::source identity: user and host name different projects"
    return 1
  fi
  ref="${href:-${uref}}"
  if [ -z "${ref}" ]; then
    echo "::error::source identity: cannot derive a project ref from the connection"
    return 1
  fi
  printf '%s' "${ref}" | sha256sum | awk '{print $1}'
}

# drill_assert_source_identity <conninfo-url> <expected-ref-sha256>
# Fails closed unless sha256(project ref of the URL) equals the expected
# non-secret value. Prints only a fixed pass/fail line; never the URL, the
# derived ref or its hash.
drill_assert_source_identity() {
  local url="$1" expected="${2:-}" actual
  if [[ ! "${expected}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "::error::source identity: expected project ref sha256 is missing or malformed (repo variable SUNRISE_SOURCE_PROJECT_REF_SHA256)"
    return 1
  fi
  actual="$(drill_source_ref_sha256 "${url}")" || { printf '%s\n' "${actual}"; return 1; }
  if [ "${actual}" != "${expected}" ]; then
    echo "::error::source identity mismatch: connection is not the expected Sunrise project; refusing to dump"
    return 1
  fi
  echo "source identity: project ref matches expected sha256"
}

# drill_schema_preflight <stage> <tables-space-list> <markers-csv> <identity-out> [conninfo]
# Read-only schema gate run BEFORE any dump: every required table must exist
# as a base table in schema public, and every identity marker must be
# present in public.schema_migrations. Writes `markers_found=N` to
# <identity-out> (compared against the restore later).
drill_schema_preflight() {
  local stage="$1" tables="$2" markers="$3" idout="$4" conn="${5:-}" t list="" n=0 dir out found want
  local -a arr=()
  read -r -a arr <<< "${tables}"
  if [ "${#arr[@]}" -eq 0 ]; then
    echo "::error::drill: no required tables"
    return 64
  fi
  for t in "${arr[@]}"; do
    if [[ ! "${t}" =~ ^[a-z_]+$ ]]; then
      echo "::error::drill: invalid required table name"
      return 64
    fi
    list="${list:+${list},}'${t}'"
    n=$((n + 1))
  done
  dir="$(drill_log_dir)"
  out="${dir}/${stage}-tables.out"
  local sql="SET default_transaction_read_only = on; SELECT 'tables_found=' || count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN (${list});"
  local -a args=(-X -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -c "${sql}")
  if [ -n "${conn}" ]; then args=("${conn}" "${args[@]}"); fi
  drill_quiet "${stage}-tables" "${out}" psql "${args[@]}" || return $?
  if ! grep -qxE 'tables_found=[0-9]+' "${out}"; then
    echo "::error::drill stage '${stage}': unexpected output shape"
    return 1
  fi
  found="$(sed -E 's/^tables_found=//' "${out}")"
  if [ "${found}" != "${n}" ]; then
    echo "::error::${stage}: required Sunrise tables missing (found ${found} of ${n}); refusing to continue"
    return 1
  fi
  drill_identity "${stage}-markers" "${idout}" "${markers}" "${conn}" || return $?
  want="$(awk -F, '{print NF}' <<< "${markers}")"
  if ! grep -qx "markers_found=${want}" "${idout}"; then
    echo "::error::${stage}: expected migration markers missing; refusing to continue"
    return 1
  fi
  echo "${stage}: ${n} required tables and ${want} migration markers present"
}

# drill_shred_dir <dir>: shred every file below dir, then remove it.
drill_shred_dir() {
  local dir="$1"
  if [ -n "${dir}" ] && [ -d "${dir}" ]; then
    find "${dir}" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf "${dir}"
  fi
}

DRILL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
