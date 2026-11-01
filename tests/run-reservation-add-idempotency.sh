#!/usr/bin/env bash
set -euo pipefail
# The fixture is throwaway, network-isolated, and contains no real data.
container_id=$(docker run --rm -d --network none -e POSTGRES_PASSWORD=local-test-only postgres:17-alpine)
trap 'docker stop "$container_id" >/dev/null' EXIT
for _attempt in $(seq 1 80); do
  if docker logs "$container_id" 2>&1 | rg -q 'PostgreSQL init process complete; ready for start up' && docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec "$container_id" pg_isready -U postgres >/dev/null
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < tests/fixtures/reservation-add-schema.sql >/dev/null
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261031173613_reservation_order_add_items_idempotency.sql >/dev/null
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < tests/reservation-status-transitions.sql >/dev/null
python3 tests/reservation-add-concurrency.py "$container_id"
python3 tests/reservation-add-status-race.py "$container_id"
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 < tests/reservation-add-idempotency.sql >/dev/null
printf '%s\n' 'Isolated PostgreSQL idempotency, rollback, replay and role checks passed.'
