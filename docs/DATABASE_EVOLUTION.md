# Database Evolution Strategy

**Sunrise Cafe** · Manual Supabase migrations with governance controls.

---

## Principles

1. **Never** run `supabase/schema.sql` against production (destructive DROP).
2. **Always** add numbered `supabase/migration-*.sql` with `schema_migrations` INSERT.
3. **Register** every new file in `supabase/migrations.manifest.json` (run `npm run sync:migrations`).
4. **Verify** before deploy: `npm run verify:migrations` + admin **Schema Status** API.
5. **Backward-compatible** column adds preferred; breaking changes require operator comms.

---

## Migration Governance

### File naming

```
migration-<domain>-<change>.sql     # e.g. migration-reservations-line-user-id.sql
migration-phase<N>-<feature>.sql    # phase-scoped batches
```

### Required footer (every migration)

```sql
INSERT INTO schema_migrations (version, name)
VALUES ('YYYYMMDD-short-name', 'migration-filename.sql')
ON CONFLICT (version) DO NOTHING;
```

### Rollout playbook

1. Develop migration locally; add to manifest.
2. Apply in **staging** Supabase SQL Editor (or psql).
3. Confirm: `SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;`
4. Apply in **production** during low-traffic window.
5. Deploy app code that depends on new columns/tables.
6. Hit `GET /api/admin/schema/status` — `drift: false`.

### CI verification (no DB)

`npm run verify:migrations` ensures:
- Every `migration-*.sql` on disk appears in `migrations.manifest.json`
- Manifest order is stable and complete
- No duplicate manifest entries

### Runtime verification (with DB)

`GET /api/admin/schema/status` returns:
- `applied` — rows from `schema_migrations`
- `expected` — manifest list
- `pending` — files not yet applied
- `drift` — boolean

---

## Schema Version Tracking

| Mechanism | Location |
|-----------|----------|
| DB table | `schema_migrations(version, name, applied_at)` |
| Repo manifest | `supabase/migrations.manifest.json` |
| Admin API | `/api/admin/schema/status` |
| Deploy API | `/api/version` (git SHA only) |

---

## Index Review (Phase 6)

New migration `migration-phase6-scale-indexes.sql`:

| Index | Supports |
|-------|----------|
| `idx_reservations_start_status` | Cron reminders, morning summary by date |
| `idx_reservations_deposit_due` | Deposit-deadline cron |
| `idx_reservations_phone_line` | Waitlist → LINE lookup |
| `idx_reservations_cancelled_at` | Cancellation analytics, DQ |
| `idx_analytics_events_created` | Retention purge, time-range BI |

Re-review indexes when:
- Any cron exceeds 10s
- BI API p95 > 3s
- Branch count > 10

---

## Query Performance Monitoring

### Admin signals

`GET /api/admin/schema/status` includes `health`:
- Row counts: `reservations`, `analytics_events`, `payment_events`
- Warnings when `analytics_events` > 500k rows without retention run
- Index presence checks (information_schema)

### Operator actions

| Symptom | Action |
|---------|--------|
| Slow admin reservation list | Confirm `idx_reservations_room_time`; filter by branch |
| Slow BI dashboard | Reduce `days` param; plan materialized views |
| Growing analytics table | Run analytics retention cron |

---

## Data Retention Policy

| Table | Retention | Mechanism |
|-------|-----------|-----------|
| `analytics_events` | **24 months** default | `purge_analytics_events_older_than(days)` + cron |
| `payment_events` | **7 years** (tax/audit) | No auto-purge; archive export |
| `reservations` | **Indefinite** (business record) | Soft-delete via `cancelled` status only |
| `demand_snapshots` | **36 months** | Optional purge (future migration) |
| `waitlist` | **90 days** after `expired`/`booked` | Optional cleanup job (future) |

### Analytics purge

- Function: `purge_analytics_events_older_than(retention_days INT DEFAULT 730)`
- Cron: `GET /api/admin/maintenance/analytics-retention` (monthly, UTC 03:00 = 11:00 Taipei)
- Requires `CRON_SECRET` or admin session
- Returns `{ deleted: N }` — log in ops channel

**Privacy:** Analytics has no PII; purging does not affect guest records.

---

## Multi-Branch Growth

| Concern | Strategy |
|---------|----------|
| Reservations without `branch_id` | Join via `rooms.branch_id`; consider denormalized column at 20+ branches |
| Per-branch reporting | `demand_snapshots`, BI APIs already branch-scoped |
| Connection limits | Supabase pooler; avoid N+1 in crons (batch room fetches) |
| Millions of analytics events | Retention + `idx_analytics_events_created`; partition table (future) |

---

## Related

- `docs/MIGRATIONS.md` — checklist
- `docs/DATA_DICTIONARY.md` — column reference
- `scripts/verify-migrations.sh`
