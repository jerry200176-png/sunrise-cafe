#!/usr/bin/env bash
# SessionStart hook for Claude Code cloud sessions: installs npm dependencies
# so `npm test`, `npm run lint` and `npm run build` work in the container.
#
# Safety contract:
#   - Cloud only: exits immediately unless CLAUDE_CODE_REMOTE=true.
#   - No third-party code runs at install time: `npm ci --ignore-scripts`
#     skips every package lifecycle script. This is the real control: the hook
#     runs as root, so an install script could read files such as the session
#     ingress token file.
#   - Defense in depth: npm runs under `env -i` with an allowlist (PATH, HOME,
#     locale, CA bundle), so GH_TOKEN, AWS_*, CLOUDSDK_*, SUNRISE_ADMIN_PASSWORD
#     and other credentials are not visible. registry.npmjs.org is in NO_PROXY,
#     so npm gets no proxy variables either.
#   - Never runs migrations, db:* or cto:* scripts, deploys, or anything
#     against Supabase/Vercel/LINE production; never touches .env files.
#   - Idempotent: skipped when package-lock.json matches the stamp from the
#     last successful install.
#   - A failed install logs and moves on; the session must still start.
#
# Build-step exceptions: none. The packages with install scripts are covered
# without them: @sentry/cli, unrs-resolver and esbuild ship prebuilt
# platform binaries as optional packages, and fsevents is macOS-only.
# Checked with `npm run build`, `npm run lint` and `npm test` after a
# --ignore-scripts install in a fresh clone.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
log() { echo "[session-start] $*" >&2; }

LOCK="$ROOT/package-lock.json"
STAMP="$ROOT/node_modules/.session-start.stamp"
[ -f "$LOCK" ] || exit 0
if ! command -v npm >/dev/null 2>&1; then
  log "npm not found; skipping install"
  exit 0
fi

hash="$(sha256sum "$LOCK" | cut -d' ' -f1)"
if [ -d "$ROOT/node_modules" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$hash" ]; then
  log "node_modules up to date"
  exit 0
fi

log "npm ci --ignore-scripts"
# Playwright browsers are large and only needed for e2e; fetch on demand with
# `npm run test:e2e:install`.
CA="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}"
if (cd "$ROOT" && env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 TERM=dumb \
      SSL_CERT_FILE="$CA" NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$CA}" \
      NODE_OPTIONS="${NODE_OPTIONS:-}" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
      npm ci --ignore-scripts --no-audit --no-fund >&2); then
  echo "$hash" > "$STAMP"
else
  log "npm ci failed; continuing"
fi
exit 0
