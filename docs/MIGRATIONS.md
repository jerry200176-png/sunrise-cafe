# Migration Status Check

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

## Pre-deploy checklist (Phase 2)

- [ ] `migration-schema-versions.sql`
- [ ] `migration-reservations-no-overlap.sql` (verify no overlaps first)

## Phase 3 migrations

- [ ] `migration-analytics-events.sql`

## Phase 5 migrations (Data Quality + Growth Engine)

- [ ] `migration-phase5-reservation-metadata.sql` — `updated_at`, cancellation metadata
- [ ] `migration-phase5-experiments.sql` — growth experiment registry
- [ ] `migration-phase5-demand-snapshots.sql` — daily demand aggregates for pricing prep

## Phase 6 migrations (Platform Governance)

- [ ] `migration-phase6-scale-indexes.sql` — cron/BI performance indexes
- [ ] `migration-phase6-analytics-retention.sql` — `purge_analytics_events_older_than`

See `docs/DATA_DICTIONARY.md`, `docs/DATABASE_EVOLUTION.md`, and `docs/PHASE6_ARCHITECTURE.md`.
