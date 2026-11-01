#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d /tmp/sunrise-batch-proof.XXXXXX)
mkdir "$work/config"
docker_local() { env -i PATH="$PATH" docker --config "$work/config" --host unix:///var/run/docker.sock "$@"; }
id=''
cleanup() { if [[ -n $id ]]; then docker_local stop -t 0 "$id" >/dev/null 2>&1 || true; fi; rm -r -- "$work"; }
trap cleanup EXIT
id=$(docker_local run -d --rm --pull=never --network none --tmpfs /var/lib/postgresql/data:rw,exec,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture postgres:17-alpine)
ready=false
for _ in {1..30}; do
  if [[ $(docker_local exec "$id" psql -X -qAt -U postgres -d fixture -c "SELECT current_setting('listen_addresses') <> ''" 2>/dev/null || true) == t ]]; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Synthetic PostgreSQL unavailable' >&2; exit 1; }
psql_local() { docker_local exec -i "$id" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d fixture "$@"; }
psql_local <<'SQL'
CREATE TABLE synthetic_claims (key text PRIMARY KEY, token uuid NOT NULL, generation integer NOT NULL, state text NOT NULL CHECK (state IN ('sending','released','failed','sent')));
CREATE FUNCTION synthetic_claim_all(keys text[]) RETURNS TABLE (key text, token uuid, generation integer) LANGUAGE plpgsql AS $$
DECLARE k text; claimed synthetic_claims%ROWTYPE;
BEGIN
  IF cardinality(keys) = 0 OR cardinality(keys) <> (SELECT count(DISTINCT x) FROM unnest(keys) x) THEN RAISE EXCEPTION 'invalid synthetic batch'; END IF;
  FOR k IN SELECT x FROM unnest(keys) x ORDER BY x LOOP
    INSERT INTO synthetic_claims AS c VALUES (k, gen_random_uuid(), 1, 'sending')
    ON CONFLICT ON CONSTRAINT synthetic_claims_pkey DO UPDATE SET token=gen_random_uuid(), generation=c.generation+1, state='sending'
      WHERE c.state = 'released' RETURNING c.* INTO claimed;
    IF NOT FOUND THEN RAISE EXCEPTION 'synthetic batch unavailable'; END IF;
    key:=claimed.key; token:=claimed.token; generation:=claimed.generation; RETURN NEXT;
  END LOOP;
END $$;
CREATE FUNCTION synthetic_release(k text, t uuid, g integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE synthetic_claims SET state='released' WHERE key=k AND token=t AND generation=g AND state='sending';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 1;
END $$;
SQL
# A later unavailable item must roll the whole batch back.
psql_local -c "INSERT INTO synthetic_claims VALUES ('z-existing', gen_random_uuid(), 1, 'sending')"
if psql_local -c "SELECT * FROM synthetic_claim_all(ARRAY['a-new','z-existing'])" >"$work/expected-failure" 2>&1; then echo 'partial batch incorrectly succeeded'; exit 1; fi
[[ $(psql_local -c "SELECT count(*) FROM synthetic_claims WHERE key='a-new'") == 0 ]]
# One of two workers obtains both keys; the other obtains neither.
set +e
psql_local -c "SELECT * FROM synthetic_claim_all(ARRAY['guest','group'])" >"$work/worker-a" 2>&1 & a=$!
psql_local -c "SELECT * FROM synthetic_claim_all(ARRAY['guest','group'])" >"$work/worker-b" 2>&1 & b=$!
wait "$a"; ra=$?
wait "$b"; rb=$?
set -e
[[ $(( (ra == 0) + (rb == 0) )) == 1 ]]
[[ $(psql_local -c "SELECT count(*) FROM synthetic_claims WHERE key IN ('guest','group') AND state='sending'") == 2 ]]
# A confirmed owner may release before attempting the provider; generation A cannot release after B takes over.
old=$(psql_local -c "SELECT token || '|' || generation FROM synthetic_claims WHERE key='guest'")
token=${old%|*}; generation=${old#*|}
[[ $(psql_local -c "SELECT synthetic_release('guest','$token'::uuid,$generation)") == t ]]
psql_local -c "SELECT * FROM synthetic_claim_all(ARRAY['guest'])" >/dev/null
[[ $(psql_local -c "SELECT synthetic_release('guest','$token'::uuid,$generation)") == f ]]
# Unknown response or old failed outcome cannot be reclaimed by the new contract.
psql_local -c "INSERT INTO synthetic_claims VALUES ('legacy-failed', gen_random_uuid(), 1, 'failed')"
for key in group legacy-failed; do
  if psql_local -c "SELECT * FROM synthetic_claim_all(ARRAY['$key'])" >"$work/expected-failure" 2>&1; then echo 'ambiguous claim incorrectly retried'; exit 1; fi
done
printf '%s\n' 'Synthetic prototype: rollback, competing whole-batch claims, stale owner CAS and unknown non-retry passed'
