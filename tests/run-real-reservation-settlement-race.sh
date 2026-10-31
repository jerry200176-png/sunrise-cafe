#!/usr/bin/env bash
set -euo pipefail
# Fresh network-isolated Postgres only. This runs repo schema.sql, which drops
# reservations: never substitute a different database/container.
container_id=$(docker run --rm -d --network none -e POSTGRES_PASSWORD=local-test-only postgres:17-alpine)
trap 'docker stop "$container_id" >/dev/null' EXIT
for _attempt in $(seq 1 80); do
  if docker logs "$container_id" 2>&1 | rg -q 'PostgreSQL init process complete; ready for start up' && docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec "$container_id" pg_isready -U postgres >/dev/null
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE PUBLICATION supabase_realtime;
SQL
for migration in schema.sql migration-schema-versions.sql migration-ordering-system.sql migration-add-is-deposit-paid.sql migration-stripe-payment-intents.sql migration-reservations-no-overlap.sql migration-reservation-preorder.sql migration-booking-meals.sql migration-reservation-settlements.sql migrations/20261031173613_reservation_order_add_items_idempotency.sql; do
  printf 'Applying isolated %s\n' "$migration"
  docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < "supabase/$migration" >/dev/null
done
python3 tests/real-reservation-settlement-race.py "$container_id"
