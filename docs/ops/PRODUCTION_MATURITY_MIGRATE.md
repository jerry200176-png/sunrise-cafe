# Production Maturity Migrate (controlled)

## Purpose

Apply catalog RLS (anon SELECT-only) + `refund_requests` **after** the Maturity A app (service-role catalog writes) is live — without handing secrets to Agents.

## Prerequisites

1. GitHub Environment named **`Production`** (existing repo Environment; case-sensitive) with secrets:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (for negative probes)
   - `SUPABASE_DB_URL` or `POSTGRES_URL_NON_POOLING`
2. Environment **required reviewers** enabled (manual approval gate)
3. Production deploy of Maturity A commit (exposes `/api/payment/status`)

## Procedure

1. Merge PR → wait until `GET /api/version` exposes Maturity markers (`/api/payment/status` 200)
2. Actions → **Production maturity migrate (RLS + refund)** → Run workflow
3. Branch = **main** (guard refuses other refs)
4. Input `confirm` = `APPLY`
5. Approve Environment gate on **`Production`** if required reviewers are configured
6. Jobs: guard → preflight → apply → probe (failed probe → workflow red)
7. Success markers in logs (no secrets): `PREFLIGHT_OK`, `APPLY_OK`, `PROBES_OK`

Environment secrets expected (Dashboard only — never paste into Agent chat):
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and one of `SUPABASE_DB_URL` / `POSTGRES_URL_NON_POOLING` / `POSTGRES_URL`.

## Blocker: Vercel Hobby deploy quota

If `vercel deploy --prod` returns `api-deployments-free-per-day`, production SHA cannot advance until quota resets (~24h) or Founder upgrades Vercel. **Do not apply catalog RLS until** `/api/payment/status` exists on production (preflight enforces).

## Deploy order safety

| Order | Result |
|-------|--------|
| App first, then RLS | ✅ Admin CRUD via service role |
| RLS before App | ❌ Blocked by preflight (`/api/payment/status` missing) |

Migrations are **idempotent** (`schema_migrations` + `ON CONFLICT DO NOTHING` / already_applied skip).

## Rollback / recovery

- Prefer forward-fix (tighten/fix policies) over blind revert.
- If admin CRUD breaks: confirm production commit has `adminHeaders` service-role writes; temporarily restore prior policies **only** with Founder approval SQL from git history.
- Refund table is additive — safe to leave in place.

## Secret hygiene

- Workflow never echoes secret values (only lengths / redacted hosts).
- Agents must not receive production DB URLs in chat.
