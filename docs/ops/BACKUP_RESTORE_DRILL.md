# Backup & Restore Drill

## Goal

Prove we can produce a restorable dump without touching production data.

## Prerequisites

- Real `SUPABASE_DB_URL` (not placeholder)
- `pg_dump` / `psql` installed
- Optional disposable Postgres for full restore (`LOCAL_DSN`)

## Commands

```bash
# 1) Backup
npm run db:backup

# 2) Non-destructive validate (default)
npm run db:restore-drill

# 3) Full restore into disposable DB
VALIDATE_ONLY=0 LOCAL_DSN='postgresql://postgres:postgres@127.0.0.1:5432/drill' npm run db:restore-drill
```

## Pass criteria

- Dump size > 1KB
- Contains `reservations` schema markers
- `DRILL_RESULT=pass`
- For full restore: `SELECT count(*) FROM reservations` succeeds

## Founder (paid)

Enable Supabase automatic backups / PITR on Pro for true DR. Scripts above are the minimum agent-executable path.
