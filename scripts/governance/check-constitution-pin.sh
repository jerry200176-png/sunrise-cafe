#!/usr/bin/env bash
# Fail if sunrise OVERLAY pin != AllTrue Constitution Version on main.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY="$ROOT/docs/governance/OVERLAY.md"
[[ -f "$OVERLAY" ]] || { echo "missing OVERLAY"; exit 1; }
PIN=$(grep -Eo 'v?[0-9]+\.[0-9]+\.[0-9]+' "$OVERLAY" | head -1 | sed 's/^v//')
TMP=$(mktemp)
curl -fsSL "https://raw.githubusercontent.com/jerry200176-png/AllTrue_System/main/docs/governance/COMPANY_CONSTITUTION.md" -o "$TMP"
VER=$(grep -E '^\*\*Version:\*\*' "$TMP" | head -1 | sed -E 's/.*Version:\*\*[[:space:]]*//;s/[[:space:]]*$//;s/^v//')
rm -f "$TMP"
echo "overlay_pin=$PIN constitution=$VER"
[[ -n "$PIN" && -n "$VER" ]] || exit 1
[[ "$PIN" == "$VER" ]] || { echo "FAIL pin drift"; exit 1; }
echo OK
