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
