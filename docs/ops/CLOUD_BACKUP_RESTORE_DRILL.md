# Cloud backup + isolated restore drill (CG-011)

Workflow: [`.github/workflows/db-backup-restore-drill.yml`](../../.github/workflows/db-backup-restore-drill.yml)
(dispatch-only, `main` only). It replaces the local `npm run db:backup` /
`db:restore-drill` path for recovery evidence — those scripts have known
defects and are **not** called by the workflow.

## What one run produces

1. `pg_dump` of schema `public` (custom format, `--no-owner`) from
   `SUPABASE_DB_URL`, in sessions forced to `default_transaction_read_only=on`.
2. Exact per-table row counts taken immediately before and after the dump
   (must be identical, otherwise the run fails — re-dispatch when quiet).
3. Restore into a throwaway `postgres:17` service with **no published ports**,
   `pg_restore --no-owner --exit-on-error --single-transaction`; the restored
   counts must equal the source counts → `drill_result=pass`.
4. The verified dump is encrypted with `age` to the public key you supply; the
   plaintext is shredded (also on failure).
5. Artifact `sunrise-db-backup-<run_id>` (14 days) containing only
   `sunrise-public.dump.age`, `sunrise-public.dump.age.sha256`, `manifest.json`.

The manifest records `created_at`, `pg_dump_version`, `source_server_version`,
`dump_sha256` (plaintext), `age_sha256`, `age_bytes`, per-table counts,
`drill_result`, and the sha256 of `supabase/migration-reservation-settlements.sql`
for context. Logs and the step summary contain no row data, URL, or SQL text.

## 1. Generate an age keypair (once, on your own machine)

```bash
# macOS: brew install age   ·   Debian/Ubuntu: sudo apt-get install age
age-keygen -o sunrise-backup.key
# prints: Public key: age1...
```

- `sunrise-backup.key` is the **private** key. Keep it offline (password
  manager / encrypted USB). Never commit it, paste it into GitHub, a chat, or
  an issue. Losing it makes every backup encrypted to it unreadable.
- Only the `age1...` public key is given to the workflow.

## 2. Dispatch

Actions → **DB backup + isolated restore drill** → Run workflow on `main` →
`age_recipient` = your `age1...` public key. Dispatch needs Founder GO (it
reads production).

The run fails closed if: the key is malformed, `SUPABASE_DB_URL` is unset,
`pg_dump` major < 17, counts drift during the dump, restore errors, or
restored counts differ.

## 3. Verify the artifact

```bash
unzip sunrise-db-backup-<run_id>.zip -d backup && cd backup
sha256sum -c sunrise-public.dump.age.sha256        # must print OK
jq '{created_at, drill_result, dump_sha256, age_sha256, table_count}' manifest.json
```

`drill_result` must be `pass`. Store the three files (still encrypted) with
the migration evidence; the artifact itself expires after 14 days.

## 4. Decrypt and restore later (only when needed)

```bash
age --decrypt -i /path/to/sunrise-backup.key -o sunrise-public.dump sunrise-public.dump.age
sha256sum sunrise-public.dump   # must equal manifest.json .dump_sha256
pg_restore --list sunrise-public.dump | head   # inspect TOC (object names only)
```

Restore into a **new, empty** Postgres 17 database first (never straight onto
production). Mirror what the drill does:

```sql
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE supabase_admin NOLOGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
```

```bash
pg_restore --list sunrise-public.dump | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > toc.filtered
pg_restore --no-owner --exit-on-error --single-transaction --use-list=toc.filtered \
  --dbname="$TARGET_DSN" sunrise-public.dump
```

Not in this backup (schema `public` only): `auth` / `storage` schemas,
extensions themselves, and realtime publication membership
(`ALTER PUBLICATION supabase_realtime ADD TABLE reservations, orders;` must be
re-applied on a real recovery). Shred the plaintext dump when done
(`shred -u sunrise-public.dump`).

## Known limits / follow-ups

- Uses the write-capable `SUPABASE_DB_URL` made read-only per session; a
  dedicated read-only role (#461) is the follow-up.
- If `SUPABASE_DB_URL` is a transaction-mode pooler (port 6543), `pg_dump` may
  fail; use the session pooler / direct URL.
