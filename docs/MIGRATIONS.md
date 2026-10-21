# Migration Status Check

> **營運逐步指南：** [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md)（核心步驟已完成 2026-07-12）  
> **SSOT：** [`IMPLEMENTATION_TRUTH.md`](./IMPLEMENTATION_TRUTH.md)

Run in Supabase SQL Editor to see which tracked migrations have been applied:

```sql
SELECT version, name, applied_at
FROM schema_migrations
ORDER BY applied_at;
```

Or from CLI (production env required):

```bash
node scripts/check-migration-drift.mjs .env.vercel.prod
```

## Production status (2026-07-12)

| Migration | Status |
|-----------|--------|
| `migration-schema-versions.sql` | ✅ |
| `migration-reservations-no-overlap.sql` | ✅ |
| `migration-phase7-rbac.sql` | ✅ |
| `migration-branches-closed-dates.sql` | ✅ |
| `migration-job-runs.sql` | ✅ |
| `migration-payment-events.sql` | ✅ |
| `migration-branches-line-group-id.sql` | 🟡 Optional — not applied |
| `migration-rls-catalog-read-only.sql` | 🔴 **Apply after deploy** — anon SELECT-only on branches/rooms/settings |

## First-time setup (new environments only)

1. Run `supabase/migration-schema-versions.sql` (creates `schema_migrations` table)
2. Apply pending `supabase/migration-*.sql` files in chronological order
3. Each new migration should include:

```sql
INSERT INTO schema_migrations (version, name)
VALUES ('YYYYMMDD-short-name', 'migration-filename.sql')
ON CONFLICT (version) DO NOTHING;
```

## Pre-deploy checklist (new migration PRs)

- [ ] Migration file includes `schema_migrations` INSERT
- [ ] `IMPLEMENTATION_TRUTH.md` updated in same PR
- [ ] `node scripts/check-migration-drift.mjs` passes against staging/prod

## Additive-only SQL gate (Gap #10, RULEBOOK F1)

`production-deploy-migrate.yml` runs migration runners on every push to `main`, so a
non-additive migration that merges would execute without a Founder step. Two controls:

1. **PR gate** (`Lint & Build`, step "Additive-only SQL gate"): `scripts/check-additive-sql.mjs`
   lints new/changed `supabase/**/*.sql` (and the SQL of any changed runner). It fails on
   `DROP`, `RENAME`, `ALTER COLUMN ... TYPE / SET NOT NULL / SET DEFAULT`, `TRUNCATE`, `DELETE FROM`, `UPDATE` /
   `ON CONFLICT DO UPDATE`, `ALTER POLICY`, `REVOKE`, `DISABLE ROW LEVEL SECURITY` / `NO FORCE` / `DISABLE TRIGGER`,
   `CREATE OR REPLACE`, and any `EXECUTE` / dynamic SQL (fail closed: it can hide any statement).
   Constraint swaps need `DROP CONSTRAINT`, so they fail too. Comments are replaced by a space, so `DELETE/**/FROM` is caught.
   Label `founder-approved-sql` overrides it. That label is the Founder's F1 decision for
   exactly this SQL; agents never add it. Re-run the job after labelling.
2. **Run-time gate** (`run-production-migration-phase.mjs`, also `--check` in CI): every
   plan entry with a `runner` needs `sql_class`:
   - `additive`: SQL is re-linted at execution time; findings abort the phase before any runner starts.
   - `founder_approved`: needs `approval` (reference to the Founder decision) and is not linted.
   - `grandfathered`: legacy entries applied before the gate; the set is frozen by a test.
   - Non-additive SQL that should not auto-run: use `"execution": "manual_sql_editor"` (no runner).

Idempotent seeds that must `UPDATE`/`ON CONFLICT DO UPDATE` can be wrapped in
`-- additive-lint: allow-update <reason>` ... `-- additive-lint: end-allow-update`. The marker exempts
UPDATE only, never DROP/DELETE/TRUNCATE. Replace `DROP POLICY IF EXISTS` + `CREATE POLICY` with a
`pg_policies` existence guard so re-runs stay additive.
