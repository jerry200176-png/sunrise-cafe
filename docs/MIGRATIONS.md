# Migration Status Check

> **營運逐步指南：** [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md)（店長可照做）

Run in Supabase SQL Editor to see which tracked migrations have been applied:

```sql
SELECT version, name, applied_at
FROM schema_migrations
ORDER BY applied_at;
```

## First-time setup

1. Run `supabase/migration-schema-versions.sql` (creates `schema_migrations` table)
2. Apply pending `supabase/migration-*.sql` files in chronological order
3. Each new migration should include:

```sql
INSERT INTO schema_migrations (version, name)
VALUES ('YYYYMMDD-short-name', 'migration-filename.sql')
ON CONFLICT (version) DO NOTHING;
```

## Pre-deploy checklist

- [ ] `migration-schema-versions.sql`
- [ ] `migration-reservations-no-overlap.sql` (verify no overlaps first)
- [ ] `migration-phase7-rbac.sql` (Wave 2 — admin users + roles)
- [ ] `migration-branches-closed-dates.sql` (Wave 3 — per-branch 公休日)
