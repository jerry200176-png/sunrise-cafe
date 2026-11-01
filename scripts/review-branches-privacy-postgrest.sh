#!/usr/bin/env bash
# Synthetic-only PostgREST/PG exercise: isolated containers, fake data and fake JWTs.
set -euo pipefail
fixture_root="$(cd "$(dirname "$0")/.." && pwd)/docs/ops/fixtures"
fixture_sql="$fixture_root/branches-column-acl.synthetic.sql"
name="sunrise-privacy-fixture-${RANDOM}-${RANDOM}"
pg="${name}-pg"
api="${name}-api"
cleanup() {
  docker rm -f "$api" "$pg" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
for image in postgres:17-alpine postgrest/postgrest:v12.2.12 node:22-alpine; do
  docker image inspect "$image" >/dev/null
done
docker network create --internal "$name" >/dev/null
docker run -d --name "$pg" --network "$name" --network-alias db --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_PASSWORD=synthetic-database-password postgres:17-alpine >/dev/null
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
docker run -d --name "$api" --network "$name" --network-alias api \
  -e PGRST_DB_URI='postgres://authenticator:synthetic-authenticator-password@db:5432/sunrise_privacy_fixture' \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET='synthetic-test-key-not-a-real-credential-123456789' postgrest/postgrest:v12.2.12 >/dev/null
docker run --rm -i --network "$name" node:22-alpine node - <<'JS'
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
# Reject unexpected ACLs before modifying anything, then restore the fixture state.
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'GRANT SELECT ON public.branches TO PUBLIC'
if docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_sql" >/dev/null 2>&1; then
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
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_sql"
# New columns must not silently become readable.
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER TABLE public.branches ADD COLUMN future_internal text;
DO $$ BEGIN IF has_column_privilege('anon','public.branches','future_internal','SELECT') THEN
  RAISE EXCEPTION 'future column exposed'; END IF; END $$;
SQL
echo 'synthetic_future_column_denied=pass'
docker run --rm -i --network "$name" node:22-alpine node - <<'JS'
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
# Show the separate database-connection risk using a synthetic role and row only.
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
SET ROLE anon;
TRUNCATE TABLE branches;
RESET ROLE;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM branches) THEN RAISE EXCEPTION 'synthetic truncate did not execute'; END IF; END $$;
SQL
echo 'synthetic_direct_database_anon_truncate_ignores_rls=demonstrated'

# Restore only the fake fixture row, then independently test the proposed narrow revoke.
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c "INSERT INTO branches(id,name) VALUES ('synthetic','Synthetic Branch')"
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q < "$fixture_root/branches-truncate-acl.synthetic.sql"
if docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q -c 'SET ROLE anon; TRUNCATE TABLE public.branches' >/dev/null 2>&1; then
  echo 'synthetic truncate revoke failed' >&2; exit 1
fi
docker exec -i "$pg" psql -U postgres -d sunrise_privacy_fixture -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.branches) <> 1
   OR NOT has_column_privilege('anon','public.branches','name','SELECT')
   OR NOT has_table_privilege('service_role','public.branches','TRUNCATE')
   OR NOT has_table_privilege('authenticated','public.branches','TRUNCATE') THEN
   RAISE EXCEPTION 'synthetic narrow revoke changed unrelated state';
 END IF;
END $$;
SQL
echo 'synthetic_direct_anon_truncate_revoked_without_other_role_changes=pass'
