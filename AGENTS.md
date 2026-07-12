# AGENTS.md

Project-specific guidance for AI agents. See also `CLAUDE.md` (architecture, gotchas,
key files), `README.md`, and `docs/` for product/deployment docs.

## Cursor Cloud specific instructions

This is a Next.js 15 app that hard-depends on Supabase (Postgres + PostgREST +
Realtime). There is one auxiliary service, `print-bridge/`, which is optional and
requires a physical USB thermal printer, so it cannot run in the cloud VM.

### Backend: use a LOCAL Supabase stack

The injected `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_URL` secrets in this environment are
placeholders (`<service_role_key>`, DB password `[password]`), not real credentials, so
the hosted Supabase project is not reachable. The dev setup instead runs a **local
Supabase stack** via Docker + the Supabase CLI (both preinstalled in the VM snapshot;
config is committed at `supabase/config.toml`).

Startup sequence (service startup — intentionally NOT in the update script):

1. Start the Docker daemon (systemd is offline in this VM, so start it manually if not
   already running), then make the socket usable:
   - `sudo dockerd &` (or run it in a tmux session)
   - `sudo chmod 666 /var/run/docker.sock`
2. `supabase start` — brings up the local stack (API gateway at `http://127.0.0.1:54321`,
   Postgres at `127.0.0.1:54322`). First run pulls images; later runs are fast.
3. `bash scripts/setup-local-supabase-db.sh` — idempotent. Applies `supabase/schema.sql`
   + `migration-*.sql` + `rls-policies.sql`, grants the standard roles table access,
   adds the `min_capacity` column (used by the app but missing from tracked migrations),
   and seeds one demo branch + two rooms if empty.
4. Create `.env.local` with the LOCAL Supabase URL + the demo keys printed by
   `supabase status`, plus an `ADMIN_PASSWORD` of your choice. Example:
   ```bash
   supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' >/dev/null # keys live here
   ```
   `.env.local` should contain:
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from `supabase status`>
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from `supabase status`>
   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   ADMIN_PASSWORD=devadmin1234567890
   ```
   (The local demo anon/service keys are fixed, public dev keys — safe to use locally.)

### GOTCHA: `.env.local` is shadowed by the injected placeholder secrets

Next.js does **not** override already-set process env vars with `.env.local`. The VM
injects `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_URL`
as (placeholder) env vars, so they shadow `.env.local` and the app fails with
`401 Invalid API key`. Start the dev server (and any node script that reads these) with
those vars unset so `.env.local` wins:

```bash
unset NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
npm run dev            # http://localhost:3000
```

### Commands

- Dev server: `npm run dev` (port 3000) — see GOTCHA above for the required `unset`.
- Lint: `npm run lint`.
- Unit tests: `npm test` (Vitest; no DB needed).
- E2E: `npm run test:e2e:install` once, then `npm run test:e2e` (Playwright; its
  `webServer` runs `npm run start`, so the same env `unset` applies and a production
  build is created).
- The `cto:*` / `executive:*` / `verify:migrations` npm scripts are internal governance
  tooling, not part of running or testing the product.

### Notes

- Core customer flows (`/book`, `/order`) and admin API routes go through Next.js API
  routes that use the **service role** key; only the realtime admin pages
  (`/admin/orders`, `/admin/print-station`, reservation list) use the anon key client-side.
- Admin login is at `/admin/login` using `ADMIN_PASSWORD`.
- Seed rooms have no images, so the booking room step shows a "無圖片" placeholder — this
  is expected, not a bug.
