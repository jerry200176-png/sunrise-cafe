#!/usr/bin/env bash
# Pre-migration recovery point (Gap #4). Runs before every production migration
# phase in production-deploy-migrate.yml. FAILS CLOSED: any error exits non-zero
# so the migration step never starts.
#
# - pg_dump (custom format, compressed, schema=public: schema + data) via the same
#   SUPABASE_DB_URL the runners use. No new secret.
# - Verifies the dump: pg_restore --list must succeed and list public.reservations data.
# - The dump contains customer PII: never printed, never uploaded unencrypted.
#   If BACKUP_AGE_RECIPIENT (age public key) is set, an encrypted copy is written and
#   the plaintext dump deleted; the workflow uploads only that ciphertext.
#   Otherwise the dump stays on the ephemeral runner and only size + sha256 are recorded.
# - Restore is Founder-only (RULEBOOK F2); see docs/RUNBOOK.md "Pre-migration backup".
#
# Test seam: PG_RUNNER is the command prefix that runs `pg_dump` / `pg_restore`
# (default: docker postgres:17, matching Supabase's major version; -i, no volumes).
set -euo pipefail

OUT_DIR="${BACKUP_OUT_DIR:-${RUNNER_TEMP:-/tmp}/db-backup}"
LABEL="${1:-premigration}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
MIN_BYTES="${BACKUP_MIN_BYTES:-1000}"

fail() { echo "::error::pre-migration backup FAILED ($1): migrations will not run" >&2; exit 1; }

[[ -n "${SUPABASE_DB_URL:-}" ]] || fail "SUPABASE_DB_URL unset"
case "$SUPABASE_DB_URL" in *"[region]"*|*"[ref]"*|*placeholder*) fail "SUPABASE_DB_URL is a placeholder";; esac

if [[ -z "${PG_RUNNER:-}" ]]; then
  command -v docker >/dev/null 2>&1 || fail "docker unavailable"
  PG_RUNNER="docker run --rm -i -e SUPABASE_DB_URL $PG_IMAGE"
fi

umask 077
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/sunrise-cafe_${LABEL}_${STAMP}.dump"

# Connection string is read from the environment inside the runner, never on a command line we echo.
# shellcheck disable=SC2086
if ! $PG_RUNNER sh -c 'exec pg_dump "$SUPABASE_DB_URL" --schema=public --format=custom --compress=6 --no-password' >"$DUMP" 2>"$OUT_DIR/pg_dump.err"; then
  # stderr may echo connection details; surface only the first error class, not the content.
  rm -f "$DUMP" "$OUT_DIR/pg_dump.err"
  fail "pg_dump exit non-zero"
fi
rm -f "$OUT_DIR/pg_dump.err"

BYTES="$(wc -c <"$DUMP" | tr -d ' ')"
[[ "$BYTES" -ge "$MIN_BYTES" ]] || { rm -f "$DUMP"; fail "dump too small ($BYTES bytes)"; }

LIST="$OUT_DIR/toc.list"
# shellcheck disable=SC2086
$PG_RUNNER pg_restore --list <"$DUMP" >"$LIST" 2>/dev/null || { rm -f "$DUMP" "$LIST"; fail "pg_restore --list rejected the dump"; }
grep -Eq 'TABLE DATA public reservations( |$)' "$LIST" || { rm -f "$DUMP" "$LIST"; fail "dump lacks public.reservations data"; }
TABLES="$(grep -c 'TABLE DATA public ' "$LIST" || true)"
rm -f "$LIST"

SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
ENCRYPTED="false"
ARTIFACT=""
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null 2>&1 || { rm -f "$DUMP"; fail "BACKUP_AGE_RECIPIENT set but age missing"; }
  age -r "$BACKUP_AGE_RECIPIENT" -o "$DUMP.age" "$DUMP" || { rm -f "$DUMP" "$DUMP.age"; fail "age encryption failed"; }
  rm -f "$DUMP"
  ENCRYPTED="true"
  ARTIFACT="$DUMP.age"
fi

MANIFEST="$OUT_DIR/manifest.json"
printf '{"label":"%s","created_at_utc":"%s","bytes":%s,"sha256":"%s","tables_with_data":%s,"encrypted":%s,"schema":"public","format":"pg_dump custom"}\n' \
  "$LABEL" "$STAMP" "$BYTES" "$SHA" "$TABLES" "$ENCRYPTED" >"$MANIFEST"

MSG="pre-migration backup OK: label=$LABEL bytes=$BYTES sha256=$SHA tables_with_data=$TABLES encrypted=$ENCRYPTED"
echo "$MSG"
[[ "$ENCRYPTED" == "true" ]] || echo "::warning::no retained backup: dump is verified but deleted at job end (set BACKUP_AGE_RECIPIENT to keep an encrypted recovery point)"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Pre-migration backup ($LABEL)"
    echo "- size: $BYTES bytes, sha256 \`$SHA\`, tables with data: $TABLES"
    if [[ "$ENCRYPTED" == "true" ]]; then echo "- encrypted (age) artifact uploaded before migrations run, 3-day retention"; else echo "- **NO RETAINED BACKUP.** The dump was verified but is deleted when this job ends (no \`BACKUP_AGE_RECIPIENT\` secret), so it is NOT a recovery point. Only size and sha256 above are kept."; fi
  } >>"$GITHUB_STEP_SUMMARY"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "encrypted=$ENCRYPTED"; echo "artifact_path=$ARTIFACT"; echo "manifest_path=$MANIFEST"; } >>"$GITHUB_OUTPUT"
fi
