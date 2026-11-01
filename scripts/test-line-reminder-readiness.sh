#!/usr/bin/env bash
# Disposable synthetic-only PostgreSQL/PostgREST integration check; no production inputs.
set -euo pipefail
command -v docker >/dev/null
command -v node >/dev/null
[[ -S /var/run/docker.sock && ! -L /var/run/docker.sock ]] || { echo 'Local Docker unavailable' >&2; exit 1; }
work="$(mktemp -d /tmp/sunrise-line-readiness.XXXXXX)"
mkdir "$work/docker-config"
suffix="${work##*.}"
network="sunrise-line-readiness-$suffix"
pg="sunrise-line-pg-$suffix"
rest="sunrise-line-rest-$suffix"
root_rest="sunrise-line-root-$suffix"
network_created=false
pg_id=''
rest_id=''
root_rest_id=''
docker_local() { env -i PATH="$PATH" docker --config "$work/docker-config" --host unix:///var/run/docker.sock "$@"; }
cleanup() {
  if [[ -n "$root_rest_id" ]]; then docker_local stop -t 0 "$root_rest_id" >/dev/null 2>&1 || true; fi
  if [[ -n "$rest_id" ]]; then docker_local stop -t 0 "$rest_id" >/dev/null 2>&1 || true; fi
  if [[ -n "$pg_id" ]]; then docker_local stop -t 0 "$pg_id" >/dev/null 2>&1 || true; fi
  if [[ "$network_created" == true ]]; then docker_local network rm "$network" >/dev/null 2>&1 || true; fi
  if [[ "$work" == /tmp/sunrise-line-readiness.* ]]; then rm -r -- "$work"; fi
}
trap cleanup EXIT
docker_local network create --internal "$network" >/dev/null
network_created=true
pg_id="$(docker_local run -d --rm --pull=never --network "$network" --network-alias pg \
  --tmpfs /var/lib/postgresql/data:rw,exec,size=256m --name "$pg" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture postgres:17-alpine)"
ready=false
for _ in $(seq 1 30); do
  if docker_local exec "$pg_id" psql -X -q -U postgres -d fixture -c 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Synthetic PostgreSQL unavailable' >&2; exit 1; }
docker_local exec -i "$pg_id" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture <<'SQL' >/dev/null
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.schema_migrations (version text PRIMARY KEY, name text);
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY, status text NOT NULL, is_notified boolean NOT NULL DEFAULT false,
  is_deposit_paid boolean NOT NULL DEFAULT false, is_reminded_7d boolean NOT NULL DEFAULT false,
  deposit_reminder_sent_at timestamptz, deposit_urgent_reminder_sent_at timestamptz
);
INSERT INTO public.reservations (id, status) VALUES ('00000000-0000-4000-8000-000000000000', 'confirmed');
SQL
docker_local exec -i "$pg_id" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture < supabase/migration-line-reminder-deliveries.sql >/dev/null
docker_local exec -i "$pg_id" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d fixture <<'SQL' >/dev/null
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, UPDATE, DELETE ON public.line_reminder_deliveries TO service_role;
CREATE FUNCTION public.synthetic_openapi_root() RETURNS json LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('sunrise_synthetic_root_probe', 'synthetic');
  RETURN '{"swagger":"2.0","paths":{}}'::json;
END $$;
GRANT EXECUTE ON FUNCTION public.synthetic_openapi_root() TO service_role;
CREATE FUNCTION public.synthetic_pre_request() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('sunrise_synthetic_pre_request', 'synthetic'); END $$;
GRANT EXECUTE ON FUNCTION public.synthetic_pre_request() TO service_role;
CREATE FUNCTION public.synthetic_volatile_claim(p_reservation_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_notify('sunrise_synthetic_volatile_claim', 'synthetic');
  RETURN p_reservation_id;
END $$;
CREATE FUNCTION public.synthetic_stale_claim(p_reservation_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$ BEGIN RETURN p_reservation_id; END $$;
GRANT EXECUTE ON FUNCTION public.synthetic_volatile_claim(uuid), public.synthetic_stale_claim(uuid) TO service_role;
SQL
rest_id="$(docker_local run -d --rm --pull=never --network "$network" --network-alias rest --name "$rest" \
  -e PGRST_DB_URI='postgres://postgres@pg:5432/fixture' -e PGRST_DB_ANON_ROLE=service_role \
  -e PGRST_DB_SCHEMAS=public -e PGRST_JWT_SECRET='synthetic-test-only-secret-at-least-32-bytes' \
  postgrest/postgrest@sha256:5f4ce744539bbba786b4e24dbbd95bdb2a956dcf568c5374995a0ff4a68f5bd2)"
root_rest_id="$(docker_local run -d --rm --pull=never --network "$network" --network-alias rootrest --name "$root_rest" \
  -e PGRST_DB_URI='postgres://postgres@pg:5432/fixture' -e PGRST_DB_ANON_ROLE=service_role \
  -e PGRST_DB_SCHEMAS=public -e PGRST_JWT_SECRET='synthetic-test-only-secret-at-least-32-bytes' \
  -e PGRST_DB_ROOT_SPEC=public.synthetic_openapi_root -e PGRST_DB_PRE_REQUEST=public.synthetic_pre_request \
  postgrest/postgrest@sha256:5f4ce744539bbba786b4e24dbbd95bdb2a956dcf568c5374995a0ff4a68f5bd2)"
# The Node client joins only the internal network; repo and already-installed
# dependencies are mounted read-only, with no host port and no production inputs.
dependency_dir="$(realpath node_modules)"
[[ -d "$dependency_dir/postgres" ]] || { echo 'Installed postgres client unavailable' >&2; exit 1; }
docker_local run --rm -i --network "$network" --pull=never \
  --mount "type=bind,src=$PWD,dst=/fixture,readonly" \
  --mount "type=bind,src=$dependency_dir,dst=$dependency_dir,readonly" \
  -w /fixture node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 node --input-type=module <<'NODE'
import { createServer, request as httpRequest } from 'node:http';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { UnverifiedRpcCache, verifyCatalog, verifyReadiness } from './scripts/apply-migration-line-reminder-deliveries.mjs';

const pg = postgres('postgres://postgres@pg:5432/fixture', { max: 1, ssl: false });
const listener = postgres('postgres://postgres@pg:5432/fixture', { max: 1, ssl: false });
const observed = [];
const server = createServer((req, res) => {
  const upstream = httpRequest({ hostname: 'rest', port: 3000,
    path: req.url.replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers }, (response) => {
    const item = { method: req.method, status: response.statusCode, allow: response.headers.allow || '', body: '' };
    response.on('data', (chunk) => { item.body = (item.body + chunk.toString()).slice(0, 300); });
    observed.push(item);
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  // Synthetic JWT: no real secret, account, user or customer data.
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const key = `${unsigned}.${createHmac('sha256', 'synthetic-test-only-secret-at-least-32-bytes').update(unsigned).digest('base64url')}`;
  const base = `http://127.0.0.1:${server.address().port}`;
  await verifyCatalog(pg);
  let unknown = false;
  try { await verifyReadiness(pg); } catch (error) { unknown = error instanceof UnverifiedRpcCache; }
  if (!unknown) throw new Error('Unverified RPC cache was accepted');
  // PostgREST 12 parses OPTIONS arguments as filters and then searches for a
  // no-argument routine: prove why it cannot safely certify this RPC.
  const rpc = new URL('/rest/v1/rpc/claim_line_reminder_delivery', base);
  for (const param of ['p_reminder_type', 'p_reminder_date', 'p_reservation_id', 'p_recipient_type', 'p_recipient_id']) rpc.searchParams.set(param, 'eq.synthetic');
  let options;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { options = await fetch(rpc, { method: 'OPTIONS', headers: { Authorization: `Bearer ${key}` } }); if (options.status !== 502) break; }
    catch { /* synthetic server may still be starting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (options.status !== 404 || (await options.json()).code !== 'PGRST202') {
    throw new Error('Unexpected synthetic PostgREST 12 OPTIONS behavior');
  }
  // GET of an OpenAPI root can execute a configured db-root-spec function;
  // PostgreSQL permits its pg_notify side effect even in a read-only transaction.
  let notifyRoot;
  const notified = new Promise((resolve) => { notifyRoot = resolve; });
  await listener.listen('sunrise_synthetic_root_probe', notifyRoot);
  let rootResponse;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { rootResponse = await fetch('http://rootrest:3000/', { headers: { Authorization: `Bearer ${key}` } }); if (rootResponse.ok) break; }
    catch { /* synthetic server may still be starting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!rootResponse?.ok || await Promise.race([notified.then(() => false), new Promise((r) => setTimeout(() => r(true), 3000))])) {
    throw new Error('Synthetic db-root-spec GET side effect was not observed');
  }
  let preRequestSeen = false;
  await listener.listen('sunrise_synthetic_pre_request', () => { preRequestSeen = true; });
  const tableResponse = await fetch('http://rootrest:3000/line_reminder_deliveries?select=id&limit=0', { headers: { Authorization: `Bearer ${key}` } });
  await new Promise((r) => setTimeout(r, 500));
  if (tableResponse.status !== 200 || !preRequestSeen) throw new Error('Synthetic table GET pre-request side effect was not observed');
  let volatileSeen = false;
  let staleSeen = false;
  await listener.listen('sunrise_synthetic_volatile_claim', () => { volatileSeen = true; });
  await listener.listen('sunrise_synthetic_stale_claim', () => { staleSeen = true; });
  const candidate = (name) => {
    const target = new URL(`/rest/v1/rpc/${name}`, base);
    target.searchParams.set('p_reservation_id', '00000000-0000-4000-8000-000000000000');
    return target;
  };
  const volatileResponse = await fetch(candidate('synthetic_volatile_claim'), { headers: { Authorization: `Bearer ${key}` } });
  await new Promise((r) => setTimeout(r, 500));
  // The synthetic PostgREST cache still sees STABLE after this change.
  await pg.unsafe(`CREATE OR REPLACE FUNCTION public.synthetic_stale_claim(p_reservation_id uuid)
    RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$ BEGIN
      PERFORM pg_notify('sunrise_synthetic_stale_claim', 'synthetic');
      RETURN p_reservation_id;
    END $$`);
  const staleResponse = await fetch(candidate('synthetic_stale_claim'), { headers: { Authorization: `Bearer ${key}` } });
  await new Promise((r) => setTimeout(r, 500));
  if (volatileResponse.status !== 200 || !volatileSeen || staleResponse.status !== 200 || !staleSeen) {
    throw new Error('Synthetic VOLATILE/stale-cache GET behavior changed; reassess the safety analysis');
  }
  console.log(JSON.stringify({ synthetic_volatile_get: volatileResponse.status, synthetic_volatile_notified: volatileSeen,
    synthetic_stale_get: staleResponse.status, synthetic_stale_notified: staleSeen }));
  const [{ n }] = await pg`SELECT count(*)::int AS n FROM public.line_reminder_deliveries`;
  if (n !== 0) throw new Error('Unexpected synthetic claim mutation');
  await pg`REVOKE EXECUTE ON FUNCTION public.claim_line_reminder_delivery(text,date,uuid,text,text) FROM service_role`;
  let rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Missing service_role EXECUTE was accepted');
  await pg`GRANT EXECUTE ON FUNCTION public.claim_line_reminder_delivery(text,date,uuid,text,text) TO service_role`;
  await pg`GRANT EXECUTE ON FUNCTION public.claim_line_reminder_delivery(text,date,uuid,text,text) TO anon`;
  rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Unexpected anon EXECUTE was accepted');
  await pg`REVOKE EXECUTE ON FUNCTION public.claim_line_reminder_delivery(text,date,uuid,text,text) FROM anon`;
  // An untrusted ledger view can execute functions even under READ ONLY.
  // The verifier must not read the ledger or fire this synthetic notification.
  let ledgerSeen = false;
  await listener.listen('sunrise_synthetic_ledger', () => { ledgerSeen = true; });
  await pg`ALTER TABLE public.schema_migrations RENAME TO synthetic_ledger_table`;
  await pg.unsafe(`CREATE FUNCTION public.synthetic_ledger_side_effect() RETURNS boolean
    LANGUAGE plpgsql VOLATILE AS $$ BEGIN PERFORM pg_notify('sunrise_synthetic_ledger', 'synthetic'); RETURN true; END $$`);
  await pg.unsafe(`CREATE VIEW public.schema_migrations AS SELECT version, name FROM public.synthetic_ledger_table
    WHERE public.synthetic_ledger_side_effect()`);
  await verifyCatalog(pg);
  await new Promise((r) => setTimeout(r, 300));
  if (ledgerSeen) throw new Error('Verifier executed a synthetic ledger view');
  await pg.begin('read only', (tx) => tx`SELECT count(*) FROM public.schema_migrations`);
  await new Promise((r) => setTimeout(r, 300));
  if (!ledgerSeen) throw new Error('Synthetic ledger view was not a valid side-effect trap');
  ledgerSeen = false;
  await pg`DROP VIEW public.schema_migrations`;
  await pg`ALTER TABLE public.synthetic_ledger_table RENAME TO schema_migrations`;
  await pg`ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY`;
  await pg`ALTER TABLE public.schema_migrations FORCE ROW LEVEL SECURITY`;
  await pg`CREATE POLICY synthetic_ledger_policy ON public.schema_migrations FOR SELECT USING (public.synthetic_ledger_side_effect())`;
  await pg`GRANT SELECT ON public.schema_migrations TO service_role`;
  await pg`SET ROLE service_role`;
  try {
    await verifyCatalog(pg);
    await new Promise((r) => setTimeout(r, 300));
    if (ledgerSeen) throw new Error('Verifier executed a synthetic ledger RLS policy');
    await pg.begin('read only', (tx) => tx`SELECT count(*) FROM public.schema_migrations`);
    await new Promise((r) => setTimeout(r, 300));
    if (!ledgerSeen) throw new Error('Synthetic ledger RLS policy was not a valid side-effect trap');
  } finally { await pg`RESET ROLE`; }
  await pg`ALTER TABLE public.reservations RENAME COLUMN deposit_urgent_reminder_sent_at TO synthetic_renamed_column`;
  rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Missing reservation column was accepted');
  await pg`ALTER TABLE public.reservations RENAME COLUMN synthetic_renamed_column TO deposit_urgent_reminder_sent_at`;
  const foreignKeys = await pg`SELECT conname FROM pg_constraint WHERE conrelid = 'public.line_reminder_deliveries'::regclass AND contype = 'f'`;
  if (foreignKeys.length !== 1) throw new Error('Unexpected synthetic foreign key fixture');
  await pg`ALTER TABLE public.line_reminder_deliveries DROP CONSTRAINT ${pg(foreignKeys[0].conname)}`;
  rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Missing reservation foreign key was accepted');
  await pg`ALTER TABLE public.line_reminder_deliveries ADD CONSTRAINT synthetic_reservation_fk FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE`;
  const primaryKeys = await pg`SELECT conname FROM pg_constraint WHERE conrelid = 'public.line_reminder_deliveries'::regclass AND contype = 'p'`;
  if (primaryKeys.length !== 1) throw new Error('Unexpected synthetic primary key fixture');
  await pg`ALTER TABLE public.line_reminder_deliveries DROP CONSTRAINT ${pg(primaryKeys[0].conname)}`;
  rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Missing delivery primary key was accepted');
  await pg`ALTER TABLE public.line_reminder_deliveries ADD PRIMARY KEY (id)`;
  const constraints = await pg`SELECT conname FROM pg_constraint WHERE conrelid = 'public.line_reminder_deliveries'::regclass AND contype = 'u'`;
  if (constraints.length !== 1) throw new Error('Unexpected synthetic unique constraint fixture');
  await pg`ALTER TABLE public.line_reminder_deliveries DROP CONSTRAINT ${pg(constraints[0].conname)}`;
  rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Missing claim uniqueness was accepted');
  await pg`DROP FUNCTION public.claim_line_reminder_delivery(text,date,uuid,text,text)`;
  rejected = false;
  try { await verifyCatalog(pg); } catch { rejected = true; }
  if (!rejected) throw new Error('Missing claim function was accepted');
  const [{ after }] = await pg`SELECT count(*)::int AS after FROM public.line_reminder_deliveries`;
  if (after !== 0) throw new Error('Unexpected mutation after denied privilege');
  console.log('Synthetic PG17/PostgREST v12 metadata, unknown-cache and no-claim checks passed');
} finally {
  server.close();
  await listener.end({ timeout: 5 });
  await pg.end({ timeout: 5 });
}
NODE
