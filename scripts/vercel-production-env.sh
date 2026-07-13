#!/usr/bin/env bash
# Pull Vercel production env vars for migration scripts (requires VERCEL_TOKEN).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${1:-.env.vercel.prod}"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN unset" >&2
  exit 1
fi

# Link project if .vercel missing (non-interactive)
if [[ ! -f .vercel/project.json ]]; then
  npx vercel link --yes --token "$VERCEL_TOKEN" 2>/dev/null || true
fi

npx vercel env pull "$OUT" --environment=production --yes --token "$VERCEL_TOKEN"
echo "Pulled production env → $OUT"
