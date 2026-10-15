# Backup & Restore Drill

> **2026-10-15：** the scheduled backup now runs in GitHub Actions
> (`.github/workflows/backup-db.yml`, age public-key encryption, 35-day artifacts ≈ 5 weekly copies).
> Setup: [`docs/RUNBOOK_DB_BACKUP.md`](../RUNBOOK_DB_BACKUP.md); drill: `scripts/restore-drill-cloud-backup.sh`.
> The local commands below (`backup-db.sh` / `restore-drill.sh`) remain for ad-hoc use;
> `scripts/backup-db.ps1` + Windows Task Scheduler is legacy.

## What “done” means (free path)

Not “script exists” — must produce:

1. Dump artifact  
2. SHA-256 checksum file  
3. Manifest JSON (bytes, retention, isolation note)  
4. `drill-result.json` with `drill_result=pass`  
5. Restore target isolation (no production host in `LOCAL_DSN`)

## Commands

```bash
# Backup artifact (+ checksum + manifest)
npm run db:backup

# Non-destructive validate (default)
npm run db:restore-drill

# Full restore into disposable local Postgres
VALIDATE_ONLY=0 LOCAL_DSN='postgresql://postgres:postgres@127.0.0.1:5432/drill' npm run db:restore-drill
```

Optional encryption: set `BACKUP_AGE_RECIPIENT` (age public key); set `BACKUP_DROP_PLAIN=1` to drop plaintext after encrypting.

## Founder-paid (optional)

Supabase Pro automatic backups / PITR — decision only. Free-path drill remains required for A− evidence.
