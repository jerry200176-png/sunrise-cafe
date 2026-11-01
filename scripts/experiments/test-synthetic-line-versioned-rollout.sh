#!/usr/bin/env bash
# SYNTHETIC RESEARCH ONLY. Not a migration, deployment, or production tool.
set -euo pipefail
work=$(mktemp -d /tmp/sunrise-line-versioned.XXXXXX)
mkdir "$work/config"
docker_local() { env -i PATH="$PATH" docker --config "$work/config" --host unix:///var/run/docker.sock "$@"; }
id=''
cleanup() { [[ -z $id ]] || docker_local stop -t 0 "$id" >/dev/null 2>&1 || true; rm -r -- "$work"; }
trap cleanup EXIT
id=$(docker_local run -d --rm --pull=never --network none --tmpfs /var/lib/postgresql/data:rw,exec,size=128m -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture postgres:17-alpine)
ready=false
for _ in {1..30}; do
  if [[ $(docker_local exec "$id" psql -X -qAt -U postgres -d fixture -c "SELECT current_setting('listen_addresses') <> ''" 2>/dev/null || true) == t ]]; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Synthetic PostgreSQL unavailable' >&2; exit 1; }
pg() { docker_local exec -i "$id" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d fixture "$@"; }
pg <<'SQL'
CREATE ROLE synthetic_owner NOLOGIN;
CREATE ROLE synthetic_old NOLOGIN;
CREATE ROLE synthetic_new NOLOGIN;
CREATE SCHEMA fixture AUTHORIZATION synthetic_owner;
SET ROLE synthetic_owner;
CREATE TABLE fixture.booking (id int PRIMARY KEY, state text NOT NULL, acct text NOT NULL, guest text, staff text NOT NULL);
CREATE TABLE fixture.legacy_ledger (booking int NOT NULL, status text NOT NULL);
INSERT INTO fixture.booking VALUES (1,'pending','account-a','guest-a','staff-a'), (2,'pending','account-a','guest-b','staff-a'),
  (3,'pending','account-a','guest-c','staff-a'), (4,'pending','account-a','guest-d','staff-a');
INSERT INTO fixture.legacy_ledger VALUES (1,'sent'),(2,'failed'),(3,'sending');
CREATE FUNCTION fixture.legacy_claim(b int) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
  INSERT INTO fixture.legacy_ledger VALUES (b,'sending');
$$;
RESET ROLE;
REVOKE ALL ON FUNCTION fixture.legacy_claim(integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA fixture TO synthetic_old,synthetic_new;
GRANT EXECUTE ON FUNCTION fixture.legacy_claim(integer) TO synthetic_old;
GRANT SELECT, INSERT, UPDATE, DELETE ON fixture.legacy_ledger TO synthetic_old;
SQL
before=$(pg -c "SELECT string_agg(booking || ':' || status, ',' ORDER BY booking) FROM fixture.legacy_ledger")
# Freeze/drain here is an explicit synthetic harness precondition, NOT an
# automatic check of production schedulers, workers, network or provider calls.
# Versioned schema creation is additive; v1 rows remain untouched.
pg <<'SQL'
BEGIN;
REVOKE EXECUTE ON FUNCTION fixture.legacy_claim(integer) FROM synthetic_old;
REVOKE SELECT, INSERT, UPDATE, DELETE ON fixture.legacy_ledger FROM synthetic_old;
SET LOCAL ROLE synthetic_owner;
CREATE TABLE fixture.v2_delivery (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), booking int NOT NULL REFERENCES fixture.booking(id),
  recipient text NOT NULL, account text NOT NULL, owner_token uuid NOT NULL, generation integer NOT NULL DEFAULT 1,
  retry_key uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(), payload_digest text NOT NULL,
  state text NOT NULL CHECK (state IN ('claimed','attempted','accepted')),
  UNIQUE (booking, recipient), UNIQUE(account, retry_key)
);
CREATE FUNCTION fixture.v2_prepare(b integer) RETURNS TABLE(delivery uuid, owner_token uuid, generation integer, account text, retry_key uuid, recipient text, payload_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
DECLARE book fixture.booking%ROWTYPE; tok uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO book FROM fixture.booking WHERE id=b FOR UPDATE;
 IF NOT FOUND OR book.state <> 'pending' THEN RETURN; END IF;
 -- Historical v1 state cannot be assumed safe, including 'failed'.
 IF EXISTS (SELECT 1 FROM fixture.legacy_ledger WHERE booking=b) OR EXISTS (SELECT 1 FROM fixture.v2_delivery WHERE booking=b) THEN RAISE EXCEPTION 'synthetic history requires reconciliation'; END IF;
 INSERT INTO fixture.v2_delivery(booking,recipient,account,owner_token,payload_digest,state)
   VALUES (b,book.staff,book.acct,tok,'synthetic-payload-v1','claimed');
 IF book.guest IS NOT NULL THEN
   INSERT INTO fixture.v2_delivery(booking,recipient,account,owner_token,payload_digest,state)
     VALUES (b,book.guest,book.acct,tok,'synthetic-payload-v1','claimed');
 END IF;
 UPDATE fixture.booking SET state='cancelled' WHERE id=b;
 RETURN QUERY SELECT d.id,d.owner_token,d.generation,d.account,d.retry_key,d.recipient,d.payload_digest FROM fixture.v2_delivery d WHERE d.booking=b ORDER BY d.recipient;
END $$;
CREATE FUNCTION fixture.v2_start(d uuid,t uuid,g integer,actual_account text,actual_payload text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
DECLARE n int;
BEGIN
 UPDATE fixture.v2_delivery SET state='attempted' WHERE id=d AND owner_token=t AND generation=g AND account=actual_account AND payload_digest=actual_payload AND state='claimed';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
CREATE FUNCTION fixture.v2_confirm(d uuid,t uuid,g integer,actual_account text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
DECLARE n int;
BEGIN
 UPDATE fixture.v2_delivery SET state='accepted' WHERE id=d AND owner_token=t AND generation=g AND account=actual_account AND state IN ('attempted','accepted');
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
RESET ROLE;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fixture FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixture.v2_prepare(integer),fixture.v2_start(uuid,uuid,integer,text,text),fixture.v2_confirm(uuid,uuid,integer,text) TO synthetic_new;
COMMIT;
SQL
# Old process after the assumed drain cannot execute v1 or mutate its ledger.
if pg -c "SET ROLE synthetic_old; SELECT fixture.legacy_claim(4)" >"$work/denied" 2>&1; then echo 'legacy RPC not fenced' >&2; exit 1; fi
if pg -c "SET ROLE synthetic_old; UPDATE fixture.legacy_ledger SET status='failed'" >"$work/denied" 2>&1; then echo 'legacy direct writes not fenced' >&2; exit 1; fi
if pg -c "SET ROLE synthetic_new; SELECT owner_token FROM fixture.v2_delivery" >"$work/denied" 2>&1; then echo 'v2 tokens exposed by broad table grant' >&2; exit 1; fi
# No historical status is automatically retried or overwritten.
for booking in 1 2 3; do
 if pg -c "SET ROLE synthetic_new; SELECT * FROM fixture.v2_prepare($booking)" >"$work/denied" 2>&1; then echo 'historical status was automatically accepted' >&2; exit 1; fi
done
[[ $(pg -c "SELECT string_agg(booking || ':' || status, ',' ORDER BY booking) FROM fixture.legacy_ledger") == "$before" ]]
[[ $(pg -c "SELECT count(*) FROM fixture.booking WHERE id IN (1,2,3) AND state='pending'") == 3 ]]
# Server chooses the same full set for both contender versions; only one wins.
pg -c "SET ROLE synthetic_new; SELECT * FROM fixture.v2_prepare(4)" >"$work/v2" & a=$!
pg -c "SET ROLE synthetic_new; SELECT * FROM fixture.v2_prepare(4)" >"$work/compat" & b=$!
wait "$a"; wait "$b"
[[ $(($(wc -l <"$work/v2") + $(wc -l <"$work/compat"))) == 2 ]]
[[ $(pg -c "SELECT string_agg(recipient,',' ORDER BY recipient) FROM fixture.v2_delivery WHERE booking=4") == 'guest-d,staff-a' ]]
[[ $(pg -c "SELECT count(DISTINCT owner_token) FROM fixture.v2_delivery WHERE booking=4") == 1 ]]
[[ $(pg -c "SELECT state FROM fixture.booking WHERE id=4") == cancelled ]]
record=$(pg -c "SELECT id || '|' || owner_token || '|' || generation || '|' || account || '|' || retry_key || '|' || payload_digest FROM fixture.v2_delivery WHERE booking=4 ORDER BY recipient LIMIT 1")
IFS='|' read -r delivery token generation account retry_key payload <<<"$record"
[[ $(pg -c "SET ROLE synthetic_new; SELECT fixture.v2_start('$delivery','$token',$generation,'wrong-account','$payload')") == f ]]
[[ $(pg -c "SET ROLE synthetic_new; SELECT fixture.v2_start('$delivery','$token',$generation,'$account','wrong-payload')") == f ]]
[[ $(pg -c "SET ROLE synthetic_new; SELECT fixture.v2_start('$delivery',gen_random_uuid(),$generation,'$account','$payload')") == f ]]
[[ $(pg -c "SET ROLE synthetic_new; SELECT fixture.v2_start('$delivery','$token',$((generation + 1)),'$account','$payload')") == f ]]
[[ $(pg -c "SET ROLE synthetic_new; SELECT fixture.v2_start('$delivery','$token',$generation,'$account','$payload')") == t ]]
# Fake provider accepts exactly once; drop its response. Client makes no
# repeated request, including after a simulated code rollback to a compatible
# adapter using the same v2 function and unchanged database privileges.
pg -c "CREATE TABLE fixture.fake_provider (account text, retry_key uuid, payload text); INSERT INTO fixture.fake_provider VALUES ('$account','$retry_key','$payload')" >/dev/null
[[ $(pg -c "SET ROLE synthetic_new; SELECT fixture.v2_start('$delivery','$token',$generation,'$account','$payload')") == f ]]
[[ $(pg -c "SELECT count(*) FROM fixture.fake_provider WHERE account='$account' AND retry_key='$retry_key'") == 1 ]]
[[ $(pg -c "SELECT state FROM fixture.v2_delivery WHERE id='$delivery'") == attempted ]]
if pg -c "SET ROLE synthetic_old; SELECT fixture.legacy_claim(4)" >"$work/denied" 2>&1; then echo 'simulated rollback reopened old RPC' >&2; exit 1; fi
[[ $(pg -c "SELECT string_agg(booking || ':' || status, ',' ORDER BY booking) FROM fixture.legacy_ledger") == "$before" ]]
printf '%s\n' 'Synthetic versioned rollout: historical quarantine, identity checks, fencing and compatible rollback passed'
