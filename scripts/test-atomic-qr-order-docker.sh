#!/usr/bin/env bash
set -euo pipefail
# Fresh network-isolated Postgres only; schema.sql drops reservations.
container_id=$(docker run --rm -d --network none -e POSTGRES_PASSWORD=local-test-only postgres:17-alpine)
trap 'docker stop "$container_id" >/dev/null' EXIT
for _attempt in $(seq 1 80); do
  if docker logs "$container_id" 2>&1 | rg -q 'PostgreSQL init process complete; ready for start up' && docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep .25
done
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE PUBLICATION supabase_realtime;
SQL
for migration in schema.sql migration-schema-versions.sql migration-ordering-system.sql migration-reservation-preorder.sql migration-booking-meals.sql migration-branches-archive.sql migration-menu-option-sets.sql migrations/20261031190000_atomic_qr_order.sql; do
  echo "Applying isolated $migration"
  docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "supabase/$migration" >/dev/null
done
python3 tests/atomic-qr-order-race.py "$container_id"
