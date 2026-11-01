#!/usr/bin/env bash
# Research fixture ONLY: no production connection, provider, data or migration.
set -euo pipefail
command -v docker >/dev/null
work=$(mktemp -d /tmp/sunrise-line-cutover.XXXXXX)
mkdir "$work/config"
docker_local() { env -i PATH="$PATH" docker --config "$work/config" --host unix:///var/run/docker.sock "$@"; }
id=''
cleanup() { [[ -z $id ]] || docker_local stop -t 0 "$id" >/dev/null 2>&1 || true; rm -r -- "$work"; }
trap cleanup EXIT
id=$(docker_local run -d --rm --pull=never --network none --tmpfs /var/lib/postgresql/data:rw,exec,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture postgres:17-alpine)
ready=false
for _ in {1..30}; do if docker_local exec "$id" pg_isready -U postgres -d fixture >/dev/null 2>&1; then ready=true; break; fi; sleep 1; done
[[ $ready == true ]] || { echo 'Synthetic PostgreSQL unavailable' >&2; exit 1; }
psql_local() { docker_local exec -i "$id" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d fixture "$@"; }
psql_local <<'SQL'
CREATE ROLE synthetic_owner NOLOGIN;
CREATE ROLE synthetic_old NOLOGIN;
CREATE ROLE synthetic_inflight NOLOGIN;
CREATE ROLE synthetic_new NOLOGIN;
CREATE SCHEMA synthetic AUTHORIZATION synthetic_owner;
SET ROLE synthetic_owner;
CREATE TABLE synthetic.bookings (id integer PRIMARY KEY, state text NOT NULL, paid boolean NOT NULL, guest text, group_id text NOT NULL);
CREATE TABLE synthetic.deliveries (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), booking integer NOT NULL REFERENCES synthetic.bookings(id),
 recipient text NOT NULL, token uuid NOT NULL, generation integer NOT NULL DEFAULT 1,
 state text NOT NULL CHECK (state IN ('claimed','attempted','accepted','released')),
 UNIQUE (booking, recipient)
);
CREATE TABLE synthetic.provider_accepts (delivery uuid NOT NULL);
INSERT INTO synthetic.bookings VALUES (1,'pending',false,'guest-synthetic','group-synthetic'),
 (2,'pending',false,'guest-synthetic','group-synthetic'),(3,'pending',false,'guest-synthetic','group-synthetic'),
 (4,'pending',false,'guest-synthetic','group-synthetic'),(5,'pending',false,'guest-synthetic','group-synthetic'),
 (6,'pending',false,'guest-synthetic','group-synthetic');
CREATE FUNCTION synthetic.legacy_claim(b integer, r text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,synthetic AS $$
  INSERT INTO synthetic.deliveries (booking, recipient, token, state) VALUES (b, r, gen_random_uuid(), 'claimed');
$$;
-- The server, not the caller, chooses the complete guest/group set.
-- Cancellation and all claims commit in one transaction in this fixture.
CREATE FUNCTION synthetic.prepare_release(b integer) RETURNS TABLE(delivery_id uuid, owner_token uuid, generation integer, recipient text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,synthetic AS $$
DECLARE book synthetic.bookings%ROWTYPE; owner uuid := gen_random_uuid();
BEGIN
 SELECT * INTO book FROM synthetic.bookings WHERE id=b FOR UPDATE;
 IF NOT FOUND OR book.state <> 'pending' OR book.paid THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM synthetic.deliveries d WHERE d.booking=b) THEN RAISE EXCEPTION 'synthetic prior claim requires review'; END IF;
 INSERT INTO synthetic.deliveries (booking, recipient, token, state) VALUES (b, book.group_id, owner, 'claimed');
 IF book.guest IS NOT NULL THEN INSERT INTO synthetic.deliveries (booking, recipient, token, state) VALUES (b, book.guest, owner, 'claimed'); END IF;
 UPDATE synthetic.bookings SET state='cancelled' WHERE id=b;
 RETURN QUERY SELECT d.id,d.token,d.generation,d.recipient FROM synthetic.deliveries d WHERE d.booking=b ORDER BY d.recipient;
END $$;
-- Commit an attempted boundary BEFORE any provider call. An unknown response
-- to this function or to the provider means stop and reconcile, never retry.
CREATE FUNCTION synthetic.begin_send(delivery uuid, owner uuid, gen integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,synthetic AS $$
DECLARE n integer;
BEGIN
 UPDATE synthetic.deliveries SET state='attempted' WHERE id=delivery AND token=owner AND generation=gen AND state='claimed';
 GET DIAGNOSTICS n = ROW_COUNT; RETURN n=1;
END $$;
CREATE FUNCTION synthetic.release_before_send(b integer, owner uuid, gen integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,synthetic AS $$
DECLARE n integer;
BEGIN
 PERFORM 1 FROM synthetic.bookings WHERE id=b FOR UPDATE;
 -- Lock every member before checking the whole batch. Otherwise begin_send
 -- could race between the check and UPDATE and cause a partial release.
 PERFORM 1 FROM synthetic.deliveries WHERE booking=b ORDER BY id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM synthetic.deliveries WHERE booking=b)
 OR EXISTS (SELECT 1 FROM synthetic.deliveries WHERE booking=b AND (token<>owner OR generation<>gen OR state<>'claimed')) THEN RETURN false; END IF;
 UPDATE synthetic.deliveries SET state='released' WHERE booking=b AND token=owner AND generation=gen AND state='claimed';
 GET DIAGNOSTICS n = ROW_COUNT; RETURN n>0;
END $$;
CREATE FUNCTION synthetic.finish_accepted(delivery uuid, owner uuid, gen integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,synthetic AS $$
DECLARE n integer;
BEGIN
 UPDATE synthetic.deliveries SET state='accepted' WHERE id=delivery AND token=owner AND generation=gen AND state IN ('attempted','accepted');
 GET DIAGNOSTICS n = ROW_COUNT; RETURN n=1;
END $$;
RESET ROLE;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA synthetic FROM PUBLIC;
GRANT USAGE ON SCHEMA synthetic TO synthetic_old, synthetic_new, synthetic_inflight;
GRANT EXECUTE ON FUNCTION synthetic.legacy_claim(integer,text) TO synthetic_old;
GRANT EXECUTE ON FUNCTION synthetic.legacy_claim(integer,text) TO synthetic_inflight;
GRANT SELECT, INSERT, UPDATE, DELETE ON synthetic.deliveries TO synthetic_old;
GRANT EXECUTE ON FUNCTION synthetic.prepare_release(integer),synthetic.begin_send(uuid,uuid,integer),synthetic.release_before_send(integer,uuid,integer),synthetic.finish_accepted(uuid,uuid,integer) TO synthetic_new;
-- Fixture cutover follows an assumed externally verified drain; revocation alone
-- does not prove already-running legacy transactions have stopped.
BEGIN;
REVOKE EXECUTE ON FUNCTION synthetic.legacy_claim(integer,text) FROM synthetic_old;
REVOKE SELECT, INSERT, UPDATE, DELETE ON synthetic.deliveries FROM synthetic_old;
COMMIT;
SQL
# A transaction that already entered the legacy function can outlive a later
# permission change.  Do not infer that REVOKE itself drains old workers.
docker_local exec -i -e PGAPPNAME=synthetic-inflight "$id" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d fixture \
  -c "SET ROLE synthetic_inflight; BEGIN; SELECT synthetic.legacy_claim(4,'inflight'); SELECT pg_sleep(4); COMMIT" >"$work/inflight" 2>&1 & inflight=$!
seen=false
for _ in {1..30}; do
  if [[ $(psql_local -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='synthetic-inflight' AND wait_event='PgSleep'") == 1 ]]; then seen=true; break; fi
  sleep 0.1
done
[[ $seen == true ]] || { echo 'Synthetic in-flight worker did not enter sleep' >&2; exit 1; }
revoked_while_active=false
if psql_local -c "SET statement_timeout='1s'; REVOKE EXECUTE ON FUNCTION synthetic.legacy_claim(integer,text) FROM synthetic_inflight" >"$work/revoke" 2>&1; then
  if kill -0 "$inflight" 2>/dev/null; then revoked_while_active=true; fi
fi
wait "$inflight"
psql_local -c "REVOKE EXECUTE ON FUNCTION synthetic.legacy_claim(integer,text) FROM synthetic_inflight" >/dev/null
[[ $(psql_local -c "SELECT count(*) FROM synthetic.deliveries WHERE booking=4 AND recipient='inflight'") == 1 ]]
if psql_local -c "SET ROLE synthetic_inflight; SELECT synthetic.legacy_claim(4,'after-revoke')" >"$work/expected-denial" 2>&1; then echo 'Revoked in-flight role retained access' >&2; exit 1; fi
printf 'Synthetic revoke completed while an old transaction was active: %s\n' "$revoked_while_active"
# A revoked old role cannot invoke the legacy RPC, directly mutate rows, or
# read ownership tokens; the new role has only the narrow functions.
for statement in "SELECT synthetic.legacy_claim(1,'old')" "INSERT INTO synthetic.deliveries (booking,recipient,token,state) VALUES (1,'old',gen_random_uuid(),'claimed')" "SELECT token FROM synthetic.deliveries"; do
 if psql_local -c "SET ROLE synthetic_old; $statement" >"$work/expected-denial" 2>&1; then echo 'Old synthetic role retained access' >&2; exit 1; fi
done
if psql_local -c "SET ROLE synthetic_new; SELECT token FROM synthetic.deliveries" >"$work/expected-denial" 2>&1; then echo 'New synthetic role could read all tokens' >&2; exit 1; fi
# Competing workers ask for the SAME booking, never caller-provided subsets.
psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release(1)" >"$work/a" 2>"$work/a-error" & a=$!
psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release(1)" >"$work/b" 2>"$work/b-error" & b=$!
wait "$a"; wait "$b"
[[ $(($(wc -l <"$work/a") + $(wc -l <"$work/b"))) == 2 ]]
[[ $(psql_local -c "SELECT count(*) FROM synthetic.deliveries WHERE booking=1 AND state='claimed'") == 2 ]]
[[ $(psql_local -c "SELECT state FROM synthetic.bookings WHERE id=1") == cancelled ]]
# Obtain only fixture identifiers as the controlling test harness.
record=$(psql_local -c "SELECT id || '|' || token || '|' || generation FROM synthetic.deliveries WHERE booking=1 ORDER BY recipient LIMIT 1")
delivery=${record%%|*}; rest=${record#*|}; token=${rest%%|*}; generation=${rest#*|}
# A deliberately tiny synthetic client: it only contacts its fake provider
# after receiving a confirmed attempted transition. The fake provider commits
# one synthetic event, then can simulate a lost response; unknown stops.
synthetic_dispatch() {
  local d=$1 t=$2 g=$3 outcome=$4
  [[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.begin_send('$d','$t',$g)") == t ]] || return 1
  psql_local -c "INSERT INTO synthetic.provider_accepts VALUES ('$d')" >/dev/null
  [[ $outcome != lost ]] || return 75
  [[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.finish_accepted('$d','$t',$g)") == t ]]
}
# Wrong owner cannot start a send; a confirmed start wins over any retry.
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.begin_send('$delivery',gen_random_uuid(),$generation)") == f ]]
set +e
synthetic_dispatch "$delivery" "$token" "$generation" lost
lost_status=$?
synthetic_dispatch "$delivery" "$token" "$generation" lost
retry_status=$?
set -e
[[ $lost_status == 75 && $retry_status == 1 ]]
# Simulated provider accepted, response lost. The batch cannot be released.
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.release_before_send(1,'$token',$generation)") == f ]]
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT count(*) FROM synthetic.prepare_release(1)") == 0 ]]
[[ $(psql_local -c "SELECT count(*) FROM synthetic.provider_accepts WHERE delivery='$delivery'") == 1 ]]
# Before any send, wrong owner fails; a correctly owned whole-batch release
# is allowed, but does not undo cancellation or automatically retry anything.
psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release(2)" >"$work/batch-two"
token2=$(psql_local -c "SELECT token FROM synthetic.deliveries WHERE booking=2 LIMIT 1")
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.release_before_send(2,gen_random_uuid(),1)") == f ]]
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.release_before_send(2,'$token2',1)") == t ]]
[[ $(psql_local -c "SELECT count(*) FROM synthetic.deliveries WHERE booking=2 AND state='released'") == 2 ]]
[[ $(psql_local -c "SELECT state FROM synthetic.bookings WHERE id=2") == cancelled ]]
# Existing synthetic ledger entry prevents a new release and rolls back the booking mutation.
psql_local -c "INSERT INTO synthetic.deliveries (booking,recipient,token,state) VALUES (3,'historical',gen_random_uuid(),'attempted')" >/dev/null
if psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release(3)" >"$work/expected-denial" 2>&1; then echo 'Prior unknown claim was accepted' >&2; exit 1; fi
[[ $(psql_local -c "SELECT state FROM synthetic.bookings WHERE id=3") == pending ]]
# Confirmed success is recorded and its finish operation may be retried safely.
psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release(5)" >"$work/batch-five"
record5=$(psql_local -c "SELECT id || '|' || token || '|' || generation FROM synthetic.deliveries WHERE booking=5 ORDER BY recipient LIMIT 1")
delivery5=${record5%%|*}; rest5=${record5#*|}; token5=${rest5%%|*}; generation5=${rest5#*|}
synthetic_dispatch "$delivery5" "$token5" "$generation5" accepted
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.finish_accepted('$delivery5','$token5',$generation5)") == t ]]
[[ $(psql_local -c "SET ROLE synthetic_new; SELECT synthetic.finish_accepted('$delivery5',gen_random_uuid(),$generation5)") == f ]]
[[ $(psql_local -c "SELECT count(*) FROM synthetic.provider_accepts WHERE delivery='$delivery5'") == 1 ]]
# If begin_send commits but its response is lost, the client makes no provider
# call; another begin is refused and the attempted state requires review.
psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release(6)" >"$work/batch-six"
record6=$(psql_local -c "SELECT id || '|' || token || '|' || generation FROM synthetic.deliveries WHERE booking=6 ORDER BY recipient LIMIT 1")
delivery6=${record6%%|*}; rest6=${record6#*|}; token6=${rest6%%|*}; generation6=${rest6#*|}
psql_local -c "SET ROLE synthetic_new; SELECT synthetic.begin_send('$delivery6','$token6',$generation6)" >"$work/lost-begin-response"
if synthetic_dispatch "$delivery6" "$token6" "$generation6" accepted; then echo 'Unknown begin was retried' >&2; exit 1; fi
[[ $(psql_local -c "SELECT count(*) FROM synthetic.provider_accepts WHERE delivery='$delivery6'") == 0 ]]
# The whole-batch release and an individual begin_send race. Exactly one may
# succeed; the other must observe the updated state without partial release.
for round in {1..10}; do
  booking=$((100 + round))
  psql_local -c "INSERT INTO synthetic.bookings VALUES ($booking,'pending',false,'guest-synthetic','group-synthetic')" >/dev/null
  psql_local -c "SET ROLE synthetic_new; SELECT * FROM synthetic.prepare_release($booking)" >"$work/race-prepare"
  race_record=$(psql_local -c "SELECT id || '|' || token || '|' || generation FROM synthetic.deliveries WHERE booking=$booking ORDER BY recipient LIMIT 1")
  race_delivery=${race_record%%|*}; race_rest=${race_record#*|}; race_token=${race_rest%%|*}; race_generation=${race_rest#*|}
  psql_local -c "SET ROLE synthetic_new; SELECT synthetic.begin_send('$race_delivery','$race_token',$race_generation)" >"$work/race-begin" & race_a=$!
  psql_local -c "SET ROLE synthetic_new; SELECT synthetic.release_before_send($booking,'$race_token',$race_generation)" >"$work/race-release" & race_b=$!
  wait "$race_a"; wait "$race_b"
  begin_result=$(cat "$work/race-begin"); release_result=$(cat "$work/race-release")
  [[ "$begin_result:$release_result" == t:f || "$begin_result:$release_result" == f:t ]]
  [[ $(psql_local -c "SELECT count(DISTINCT state) FROM synthetic.deliveries WHERE booking=$booking AND state IN ('attempted','released')") == 1 ]]
done
printf '%s\n' 'Synthetic cutover: role denial, atomic booking bundle, owner CAS and unknown-provider stop passed'
