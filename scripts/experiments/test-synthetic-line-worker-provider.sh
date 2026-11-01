#!/usr/bin/env bash
# SYNTHETIC RESEARCH ONLY: no production services, credentials or migration.
set -euo pipefail
work=$(mktemp -d /tmp/sunrise-line-workers.XXXXXX)
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
docker_local exec -i "$id" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture <<'SQL'
CREATE ROLE synthetic_owner NOLOGIN;
CREATE ROLE synthetic_new NOLOGIN;
CREATE ROLE synthetic_old NOLOGIN;
CREATE SCHEMA fixture AUTHORIZATION synthetic_owner;
SET ROLE synthetic_owner;
CREATE TABLE fixture.delivery (id uuid PRIMARY KEY, owner_token uuid NOT NULL, generation int NOT NULL,
 account text NOT NULL, payload text NOT NULL, state text NOT NULL CHECK(state IN ('claimed','attempted','accepted')));
INSERT INTO fixture.delivery VALUES
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000006',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000007',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000008',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000009',1,'synthetic-account-a','synthetic-payload','claimed'),
 ('00000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000010',1,'synthetic-account-a','synthetic-payload','claimed');
CREATE FUNCTION fixture.begin_send(d uuid, t uuid, g integer, acct text, body text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
DECLARE n integer;
BEGIN
 UPDATE fixture.delivery SET state='attempted' WHERE id=d AND owner_token=t AND generation=g AND account=acct AND payload=body AND state='claimed';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
CREATE FUNCTION fixture.confirm(d uuid, t uuid, g integer, acct text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
DECLARE n integer;
BEGIN
 UPDATE fixture.delivery SET state='accepted' WHERE id=d AND owner_token=t AND generation=g AND account=acct AND state IN ('attempted','accepted');
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
CREATE FUNCTION fixture.legacy_claim(d uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,fixture AS $$
 UPDATE fixture.delivery SET state='claimed' WHERE id=d;
$$;
RESET ROLE;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fixture FROM PUBLIC;
GRANT USAGE ON SCHEMA fixture TO synthetic_new,synthetic_old;
GRANT EXECUTE ON FUNCTION fixture.begin_send(uuid,uuid,integer,text,text),fixture.confirm(uuid,uuid,integer,text) TO synthetic_new;
GRANT EXECUTE ON FUNCTION fixture.legacy_claim(uuid) TO synthetic_old;
-- The synthetic controller revokes the old DB function. This cannot itself
-- stop a process that already holds fake provider credentials.
REVOKE EXECUTE ON FUNCTION fixture.legacy_claim(uuid) FROM synthetic_old;
SQL
# Explicitly strip real credentials and environment. Provider binds only an
# ephemeral loopback port and accepts only randomly generated synthetic auth.
env -i PATH="$PATH" node scripts/experiments/synthetic-line-workers.mjs "$id" "$work/config"
