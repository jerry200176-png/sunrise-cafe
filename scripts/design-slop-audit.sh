#!/usr/bin/env bash
# Lightweight anti-slop audit (Hallmark-inspired, brand-scoped)
# Usage:
#   bash scripts/design-slop-audit.sh
#   bash scripts/design-slop-audit.sh --strict   # exit 1 on any hit
#
# Does NOT replace hallmark skill — runs fast CI-friendly grep checks only.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TARGET="${DESIGN_AUDIT_TARGET:-src}"
STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

hits=0

check() {
  local id="$1"
  local desc="$2"
  local pattern="$3"
  local matches
  matches="$(rg -n "$pattern" "$TARGET" \
    --glob '!**/*.test.*' \
    --glob '!**/node_modules/**' 2>/dev/null || true)"
  if [[ -n "$matches" ]]; then
    hits=$((hits + 1))
    echo "── [$id] $desc"
    echo "$matches" | head -8
    local total
    total="$(echo "$matches" | wc -l | tr -d ' ')"
    [[ "$total" -gt 8 ]] && echo "   … +$((total - 8)) more"
    echo
  fi
}

echo "Design slop audit · target=$TARGET · Hallmark-inspired subset"
echo "Brand SSOT: DESIGN.md (Warm Artisan Editorial)"
echo

# Universal AI tells (aligned with hallmark slop-test + our DESIGN.md Don'ts)
check "S1" "Inter / Roboto / Poppins as font family" \
  'font-(inter|roboto|poppins)|fontFamily:\s*["'\''](Inter|Roboto|Poppins)|family=Inter|family=Roboto|family=Poppins'

check "S2" "Purple/blue gradient or gradient text" \
  'from-purple|to-purple|from-blue-5|to-blue-5|bg-clip-text|text-transparent.*gradient'

check "S3" "transition-all (specify properties)" \
  'transition-all'

check "S4" "Uniform hover scale on UI" \
  'hover:scale-10[0-9]|hover:scale-\['

check "S5" "Cold blue on interactive (prefer caramel/stone)" \
  'bg-blue-[56]00|peer-checked:bg-blue|focus:ring-blue|shadow-blue'

check "S6" "Pure #000/#fff hex surfaces" \
  'bg-\[#000|bg-\[#fff|bg-\[#000000|bg-\[#ffffff\]'

check "S7" "Emoji as UI icons (in className/JSX)" \
  'className=.*[✨🚀⚡🔥🎯]|>[✨🚀⚡🔥🎯]'

echo "────────────────────────────────────────"
if [[ "$hits" -eq 0 ]]; then
  echo "OK — no slop patterns in subset ($TARGET)"
  exit 0
fi

echo "Found $hits pattern group(s). See docs/internal/design/HALLMARK_ADOPTION.md"
echo "Fix or document exceptions in DESIGN.md before merge."

if [[ "$STRICT" -eq 1 ]]; then
  exit 1
fi
exit 0
