#!/usr/bin/env bash
# Local development setup for Sunrise Cafe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Sunrise Cafe — dev setup ==="
echo ""

if [[ ! -f .env.local ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env.local
    echo "Created .env.local from .env.example"
  else
    cat > .env.local <<'EOF'
# Minimum local dev — see docs/ENV.md
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=dev-admin-change-me
EOF
    echo "Created .env.local template — fill in Supabase values"
  fi
else
  echo ".env.local already exists"
fi

echo ""
echo "Installing npm dependencies..."
npm ci

echo ""
echo "Verifying migration manifest..."
bash scripts/verify-migrations.sh

echo ""
echo "Setup complete. Next steps:"
echo "  1. Edit .env.local (docs/ENV.md)"
echo "  2. npm run verify:env"
echo "  3. npm run dev"
echo ""
echo "Onboarding: docs/ONBOARDING.md"
