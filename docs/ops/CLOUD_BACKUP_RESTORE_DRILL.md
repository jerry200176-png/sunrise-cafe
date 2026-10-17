# Cloud backup + isolated restore drill (CG-011)

Workflow: [`.github/workflows/db-backup-restore-drill.yml`](../../.github/workflows/db-backup-restore-drill.yml)
(dispatch-only, `main` only), helpers in [`scripts/db-drill/`](../../scripts/db-drill/).
It replaces the local `npm run db:backup` / `db:restore-drill` path for
recovery evidence. Those scripts have known defects, and the workflow does
**not** call them.

> **Scope: public-schema recovery only. This is NOT a full Supabase recovery.**
> The backup covers tables, data, functions, policies and grants in schema
> `public`. It does **not** include `auth` (users / sessions), `storage`,
> extensions, roles, realtime publication membership, or project settings.

## Before the first dispatch: authorization required

Each item below needs an explicit Founder decision. Draft or merged code does
not authorize exporting production data.

- **Dispatch GO.** The run reads production.
- **Storage audience and retention.** The run stores an encrypted copy of
  production data as a GitHub Actions artifact for 14 days. Anyone who can
  read this repo's Actions artifacts can download the ciphertext. Approve
  that audience and the retention, or change them first.
- **Public aggregate metadata.** The step summary and the uploaded
  `manifest.json` (not encrypted) show the table count, the total row count
  and checksums. Approve publishing those numbers.
- **Key owner.** Name the single person who holds the age private key.
- **Expected source identity.** Set the repository **variable** (not a
  secret) `SUNRISE_SOURCE_PROJECT_REF_SHA256` to the sha256 of the
  production Supabase project ref (the 20-character id in
  `db.<ref>.supabase.co`). Compute it on your own machine, e.g.
  `printf '%s' '<ref>' | sha256sum`. Without it, every run fails closed
  before connecting.

## What one run produces

1. **Source gate, before any dump.** Two checks, in this order:
   1. **Project identity (no network).** The project ref is taken from
      `SUPABASE_DB_URL` (host `db.<ref>.supabase.co`, or pooler user
      `postgres.<ref>`). Its sha256 must equal
      `SUNRISE_SOURCE_PROJECT_REF_SHA256`. Unrecognized URL shapes,
      `hostaddr`/`host`/`service` overrides and `PGHOSTADDR`/`PGSERVICE` all
      fail closed. URL `sslmode`, when present, must be `require`, `verify-ca`,
      or `verify-full`; duplicate or encoded parameter names are rejected.
      The URL, host, ref and hash are never printed. This is what
      stops a staging clone: it has the same schema, but a different ref.
   2. **Schema (one read-only query).** The source must contain the required
      Sunrise tables (`reservations`, `orders`, `order_items`, `rooms`,
      `schema_migrations`). Its `schema_migrations` must also contain the
      fixed migration markers (`IDENTITY_MARKERS` in the workflow).

   If either check fails, the run stops and `pg_dump` is never called.
2. **Dump.** `pg_dump` of schema `public` (custom format, `--no-owner`), with
   every session forced to `default_transaction_read_only=on`. Exact
   per-table row counts are taken right before and right after the dump. They
   must be identical; otherwise the run fails, and you re-dispatch at a
   quieter time.
3. **Restore drill.** The dump is restored into a throwaway `postgres:17`
   service with **no published ports**, using
   `pg_restore --no-owner --exit-on-error --single-transaction`. The restored
   DB must pass the same table and marker checks, and its per-table counts
   must equal the source's. Only then is `drill_result=pass`.
4. **Encryption.** The verified dump and the per-table counts are bundled into
   one tar (`sunrise-public-bundle.tar`), encrypted with `age` to the public
   key you supply. The plaintext is shredded, also on failure.
5. **Artifact.** `sunrise-db-backup-<run_id>` (14 days) contains only:
   - `sunrise-public-bundle.tar.age`: dump + `source.counts` +
     `restore.counts` + `source.identity`, all encrypted.
   - `sunrise-public-bundle.tar.age.sha256`
   - `manifest.json`: not encrypted. Totals and checksums only: `created_at`,
     versions, `dump_sha256` / `bundle_sha256` (plaintext), `age_sha256`,
     `table_count`, `total_rows`, `identity_check`, `drill_result`, the
     settlements migration sha256 for context, and `recovery_scope`. It has
     no per-table counts.

**Log safety.** psql / pg_dump / pg_restore output never reaches the Actions
log. It goes to mode-600 files under `$RUNNER_TEMP/drill-logs`, which are
never uploaded and are shredded at the end. A failure prints only
`stage`, `exit` and an allowlisted SQLSTATE class, never message text. If
you need more detail, reproduce locally against a non-production copy. Do not
add printing to the workflow.

## 1. Generate an age keypair (key owner, once, on your own machine)

```bash
# macOS: brew install age   ·   Debian/Ubuntu: sudo apt-get install age
age-keygen -o sunrise-backup.key
# prints: Public key: age1...
```

- `sunrise-backup.key` is the **private** key. Keep it offline (password
  manager or encrypted USB).
- **Never share the private key.** Don't commit it, and don't paste it into
  GitHub, a secret, a chat, an issue or an agent session. Nobody (including
  an AI agent) should ever ask for it.
- Losing the key makes every backup encrypted to it unreadable.
- Only the `age1...` public key is given to the workflow.

## 2. Dispatch (after the authorizations above)

Actions → **DB backup + isolated restore drill** → Run workflow on `main` →
set `age_recipient` to the key owner's `age1...` public key.

The run fails closed if any of these happen:
- the key is malformed;
- `SUPABASE_DB_URL` is unset;
- `SUNRISE_SOURCE_PROJECT_REF_SHA256` is unset, or doesn't match the URL's
  project (checked before any connection);
- `pg_dump` major is below 17;
- the source is missing Sunrise tables or markers (checked before the dump);
- counts change during the dump;
- the restore errors;
- restored counts or markers differ from the source.

## 3. Key owner: decrypt-verify (required for the evidence to count)

A run's `drill_result=pass` proves the dump restored inside the runner. The
**key owner** must also prove the retained ciphertext decrypts back to
exactly that plaintext:

```bash
unzip sunrise-db-backup-<run_id>.zip -d backup && cd backup
sha256sum -c sunrise-public-bundle.tar.age.sha256          # must print OK
jq '{recovery_scope, drill_result, identity_check, dump_sha256, bundle_sha256, table_count, total_rows}' manifest.json

age --decrypt -i /path/to/sunrise-backup.key -o bundle.tar sunrise-public-bundle.tar.age
sha256sum bundle.tar                       # must equal manifest .bundle_sha256
mkdir restore && tar -xf bundle.tar -C restore
sha256sum restore/sunrise-public.dump      # must equal manifest .dump_sha256
cmp restore/source.counts restore/restore.counts && echo counts-match
```

Then record in the migration evidence: the run id, `age_sha256`, the result
of each checksum check above (OK / equal), and who verified and when. Do not
record contents. Shred the plaintext afterwards:
`shred -u bundle.tar restore/*`.

## 4. Restore later (only when needed)

Restore into a **new, empty** Postgres 17 database first. Never restore
straight onto production. Mirror the drill's preparation:

```sql
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE supabase_admin NOLOGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE PUBLICATION supabase_realtime;
```

```bash
pg_restore --list restore/sunrise-public.dump | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > toc.filtered
pg_restore --no-owner --exit-on-error --single-transaction --use-list=toc.filtered \
  --dbname="$TARGET_DSN" restore/sunrise-public.dump
```

Because this is public-schema only, a real recovery also has to re-create
what lives outside `public`:
- `auth` users;
- storage objects;
- realtime publication membership:
  `ALTER PUBLICATION supabase_realtime ADD TABLE reservations, orders;`

## Known limits and follow-ups

- **What the identity gate proves.** It proves the URL names the expected
  project, and that the project has the Sunrise schema. It cannot detect a
  DNS or network-level redirect. TLS (`PGSSLMODE=require`) encrypts the
  connection but does not verify the server certificate.

- **Write-capable credential.** The run uses the write-capable
  `SUPABASE_DB_URL` and makes it read-only per session. A dedicated read-only
  role (#461) is the follow-up.
- **Pooler URLs.** If `SUPABASE_DB_URL` is a transaction-mode pooler (port
  6543), `pg_dump` may fail. Use the session pooler or the direct URL.
