#!/usr/bin/env bash
# Delete stale cursor/* remote branches (merged or auto-loop leftovers).
# Usage: bash scripts/repo-hygiene-cleanup.sh [--apply]
set -euo pipefail

APPLY="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "## Repository branch cleanup"
git fetch origin --prune -q

STALE=()
while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  [[ "$branch" == "main" ]] && continue
  if [[ "$branch" == cursor/auto-* ]] || [[ "$branch" == cursor/setup-dev-environment-* ]]; then
    STALE+=("$branch")
  fi
done < <(git branch -r | sed 's|origin/||' | tr -d ' ' | sort -u)

echo "Found ${#STALE[@]} stale cursor/* branches"
if [[ ${#STALE[@]} -eq 0 ]]; then
  exit 0
fi

printf '  %s\n' "${STALE[@]}"

if [[ "$APPLY" != "--apply" ]]; then
  echo "Dry-run — pass --apply to delete"
  exit 0
fi

for b in "${STALE[@]}"; do
  git push origin --delete "$b" 2>/dev/null && echo "deleted $b" || echo "skip $b"
done

echo "Done."
