#!/usr/bin/env bash
# SessionStart hook for Claude Code cloud sessions: installs npm dependencies
# so `npm test`, `npm run lint` and `npm run build` work in the container.
#
# Safety contract:
#   - Cloud only: exits immediately unless CLAUDE_CODE_REMOTE=true.
#   - Installs packages only. Never runs migrations, db:* or cto:* scripts,
#     deploys, or anything against Supabase/Vercel/LINE production.
#   - Reads no secrets and never touches .env files.
#   - Idempotent: skipped when package-lock.json matches the stamp from the
#     last successful install.
#   - A failed install logs and moves on; the session must still start.
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

log "npm ci"
# Playwright browsers are large and only needed for e2e; fetch on demand with
# `npm run test:e2e:install`.
if (cd "$ROOT" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund >&2); then
  echo "$hash" > "$STAMP"
else
  log "npm ci failed; continuing"
fi
exit 0
