#!/usr/bin/env bash
# Synthetic-only PostgREST/PG exercise: isolated containers, fake data and fake JWTs.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_sql="$root/supabase/migration-20261101-branches-public-column-select.sql"
rollback_sql="$root/docs/ops/rollback-20261101-branches-public-column-select.sql"
name="sunrise-privacy-fixture-${RANDOM}-${RANDOM}"
network_id=""
pg=""
api=""
cleanup() {
  if [[ -n "$api" ]]; then docker rm -f "$api" >/dev/null 2>&1 || true; fi
  if [[ -n "$pg" ]]; then docker rm -f "$pg" >/dev/null 2>&1 || true; fi
  if [[ -n "$network_id" ]]; then docker network rm "$network_id" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM
for image in postgres:17-alpine postgrest/postgrest:v12.2.12 node:22-alpine; do
  docker image inspect "$image" >/dev/null
done
network_id=$(docker network create --internal "$name")
pg=$(docker run -d --network "$network_id" --network-alias db --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_PASSWORD=synthetic-database-password postgres:17-alpine)
for i in $(seq 1 120); do
  if docker logs "$pg" 2>&1 | grep -q 'PostgreSQL init process complete' && \
    docker exec "$pg" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  read -r -t 0.2 || true
done
docker exec -i "$pg" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'synthetic-authenticator-password';
GRANT anon,authenticated,service_role TO authenticator;
CREATE DATABASE sunrise_privacy_fixture;
SQL
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE branches (
 id text primary key, name text, address text, phone text, created_at timestamptz,
 open_time time, close_time time, display_name text, payment_info text, line_pay_url text,
 closed_dates jsonb, rental_notes jsonb, deposit_info text, google_review_url text,
 weekly_hours jsonb, line_group_id text, archived_at timestamptz
);
INSERT INTO branches(id,name,line_group_id,payment_info,line_pay_url) VALUES
 ('synthetic','Synthetic Branch','synthetic-line','synthetic-payment','https://example.invalid');
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_select ON branches FOR SELECT TO anon USING (true);
GRANT ALL ON branches TO anon,authenticated,service_role;
SQL
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$root/docs/ops/branches-select-acl-metadata.sql" >/dev/null
api=$(docker run -d --network "$network_id" --network-alias api \
  -e PGRST_DB_URI='postgres://authenticator:synthetic-authenticator-password@db:5432/sunrise_privacy_fixture' \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET='synthetic-test-key-not-a-real-credential-123456789' postgrest/postgrest:v12.2.12)
docker run --rm -i --network "$network_id" node:22-alpine node - <<'JS'
(async () => {
  for (let i=0; i<100; i++) {
    try {
      const response = await fetch('http://api:3000/branches?select=line_group_id');
      if (response.ok) {
        const rows = await response.json();
        if (rows[0]?.line_group_id !== 'synthetic-line') throw new Error('bad fixture');
        console.log('synthetic_prechange_anon_private_read=demonstrated');
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve,100));
  }
  throw new Error('synthetic PostgREST did not start');
})().catch((error) => { console.error(error.message); process.exit(1); });
JS
if docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_sql" >/dev/null 2>&1; then
  echo 'forward accepted missing acknowledgement' >&2; exit 1
fi
echo 'synthetic_missing_forward_ack_denied=pass'
# Reject unexpected ACLs before modifying anything, then restore the fixture state.
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'GRANT SELECT ON public.branches TO PUBLIC'
if docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_review_ack=reviewed-target-and-scope" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_sql" >/dev/null 2>&1; then
  echo 'unexpected ACL guard failure' >&2; exit 1
fi
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT has_table_privilege('anon','public.branches','SELECT')
     OR (SELECT count(*) FROM public.branches) <> 1 THEN
    RAISE EXCEPTION 'guard failure changed the fixture';
  END IF;
END $$;
SQL
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'REVOKE SELECT ON public.branches FROM PUBLIC'
echo 'synthetic_unexpected_public_grant_fail_closed=pass'
expect_forward_refusal() {
  if docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_review_ack=reviewed-target-and-scope" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_sql" >/dev/null 2>&1; then
    echo 'forward accepted unexpected fixture state' >&2; exit 1
  fi
  docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT has_table_privilege('anon','public.branches','SELECT') OR (SELECT count(*) FROM public.branches) <> 1 THEN
    RAISE EXCEPTION 'failed forward changed the fixture';
  END IF;
END $$;
SQL
}
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE branches ADD COLUMN unexpected_private text'
expect_forward_refusal
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE branches DROP COLUMN unexpected_private'
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'CREATE POLICY unexpected_policy ON branches FOR SELECT TO anon USING (true)'
expect_forward_refusal
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'DROP POLICY unexpected_policy ON branches'
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'GRANT SELECT (line_group_id) ON branches TO anon'
expect_forward_refusal
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'REVOKE SELECT (line_group_id) ON branches FROM anon'
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'CREATE ROLE synthetic_inherited NOLOGIN; GRANT synthetic_inherited TO anon'
expect_forward_refusal
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'REVOKE synthetic_inherited FROM anon; DROP ROLE synthetic_inherited'
echo 'synthetic_schema_policy_column_acl_and_role_drift_denied=pass'
acl_query="SELECT c.relacl::text || '|' || string_agg(a.attname || ':' || coalesce(a.attacl::text, 'NULL'), '|' ORDER BY a.attname) FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.oid='public.branches'::regclass AND a.attnum>0 AND NOT a.attisdropped GROUP BY c.relacl::text"
original_acl=$(docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -Atq -c "$acl_query")
docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_review_ack=reviewed-target-and-scope" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_sql"
# New columns must not silently become readable.
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER TABLE public.branches ADD COLUMN future_internal text;
DO $$ BEGIN IF has_column_privilege('anon','public.branches','future_internal','SELECT') THEN
  RAISE EXCEPTION 'future column exposed'; END IF; END $$;
SQL
echo 'synthetic_future_column_denied=pass'
docker run --rm -i --network "$network_id" node:22-alpine node - <<'JS'
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const secret = 'synthetic-test-key-not-a-real-credential-123456789';
const encode = (v) => Buffer.from(v).toString('base64url');
function token(role) {
  const message = encode(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+encode(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+300}));
  return message+'.'+crypto.createHmac('sha256',secret).update(message).digest('base64url');
}
async function request(path, role, method='GET', body) {
  const headers = {};
  if (role) headers.Authorization = 'Bearer '+token(role);
  if (body) Object.assign(headers,{'Content-Type':'application/json',Prefer:'return=representation'});
  const response = await fetch('http://api:3000'+path,{method,headers,body});
  return [response.status,await response.text()];
}
(async () => {
  const publicPath='/branches?select=id,name,address,phone,open_time,close_time,closed_dates,display_name,rental_notes,deposit_info&archived_at=is.null&order=name.asc';
  let [status,body] = await request(publicPath);
  assert.equal(status,200); assert.equal(JSON.parse(body)[0].id,'synthetic');
  console.log('synthetic_anon_explicit_public_list=pass');
  for (const col of ['line_group_id','payment_info','line_pay_url','*']) {
    [status] = await request('/branches?select='+col); assert.ok([401,403].includes(status),`${col}: ${status}`);
  }
  console.log('synthetic_anon_sensitive_and_star_denied=pass');
  [status,body] = await request('/branches?select=line_group_id,payment_info','service_role');
  assert.equal(status,200); assert.equal(JSON.parse(body)[0].line_group_id,'synthetic-line');
  [status,body] = await request('/branches?select=id,name','authenticated');
  assert.equal(status,200); assert.deepEqual(JSON.parse(body),[]);
  console.log('synthetic_service_and_authenticated_rls=pass');
  [status,body] = await request('/branches?id=eq.synthetic',null,'PATCH',JSON.stringify({name:'wrong'}));
  assert.ok([200,204,401,403].includes(status)); if ([200,204].includes(status)) assert.deepEqual(body?JSON.parse(body):[],[]);
  [status] = await request('/branches',null,'POST',JSON.stringify({id:'bad'})); assert.ok([401,403].includes(status));
  [status] = await request('/branches',null,'TRUNCATE'); assert.ok([404,405].includes(status),status);
  console.log('synthetic_http_mutations_restricted_and_truncate_method_unavailable=pass');
})().catch((error) => { console.error(error.message); process.exit(1); });
JS
# Verify the rollback rejects schema drift, ACL drift and a missing acknowledgement.
if docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_rollback_ack=reviewed-exposure-and-target" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$rollback_sql" >/dev/null 2>&1; then
  echo 'rollback accepted schema drift' >&2; exit 1
fi
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE public.branches DROP COLUMN future_internal'
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'CREATE POLICY unexpected_policy ON branches FOR SELECT TO anon USING (true)'
if docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_rollback_ack=reviewed-exposure-and-target" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$rollback_sql" >/dev/null 2>&1; then
  echo 'rollback accepted policy drift' >&2; exit 1
fi
docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'DROP POLICY unexpected_policy ON branches'
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'GRANT SELECT (line_group_id) ON public.branches TO anon'
if docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_rollback_ack=reviewed-exposure-and-target" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$rollback_sql" >/dev/null 2>&1; then
  echo 'rollback accepted ACL drift' >&2; exit 1
fi
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'REVOKE SELECT (line_group_id) ON public.branches FROM anon'
if docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$rollback_sql" >/dev/null 2>&1; then
  echo 'rollback accepted missing acknowledgement' >&2; exit 1
fi
docker exec -i -e PGOPTIONS="-c sunrise.branches_acl_rollback_ack=reviewed-exposure-and-target" "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$rollback_sql"
restored_acl=$(docker exec "$pg" psql -U postgres -d sunrise_privacy_fixture -Atq -c "$acl_query")
[[ "$original_acl" == "$restored_acl" ]]
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT has_table_privilege('anon','public.branches','SELECT')
    OR NOT has_table_privilege('authenticated','public.branches','SELECT')
    OR NOT has_table_privilege('service_role','public.branches','SELECT')
    OR (SELECT count(*) FROM public.branches) <> 1 THEN
    RAISE EXCEPTION 'synthetic rollback did not restore expected ACL';
  END IF;
END $$;
SQL
echo 'synthetic_rollback_drift_denied_and_original_acl_restored=pass'
