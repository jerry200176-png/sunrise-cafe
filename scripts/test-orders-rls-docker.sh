#!/usr/bin/env bash
set -euo pipefail
# Test-only, isolated container; mounted migration and fixtures are read-only.
container_id=$(docker run --rm -d --network none -e POSTGRES_PASSWORD=local-test-only -v "$PWD/supabase:/work/supabase:ro" -w /work postgres:17-alpine)
trap 'docker stop "$container_id" >/dev/null' EXIT
for _attempt in $(seq 1 80); do
  if docker logs "$container_id" 2>&1 | rg -q 'PostgreSQL init process complete; ready for start up' && docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep .25
done
docker exec -w /work "$container_id" psql -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/orders-anon-insert-revoke.test.sql
