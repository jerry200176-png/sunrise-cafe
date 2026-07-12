# AGENTS.md

Project-wide guidance for AI agents. See `CLAUDE.md` for the full architecture
handbook (LINE dual-channel setup, timezone traps, payment automation, key file
locations). This file adds environment/run notes specific to Cursor Cloud.

## Cursor Cloud specific instructions

This is a Next.js 15 (App Router) + TypeScript + Tailwind app backed by Supabase.
Node 22 and npm are used. Standard commands live in `package.json` and CI in
`.github/workflows/ci.yml` — refer to those rather than duplicating them:
`npm run lint`, `npm test` (Vitest), `npm run build`, `npm run dev`,
`npm run test:e2e` (Playwright).

Non-obvious caveats:

- **`.env.local` is required to run the app** and is gitignored, so it does not
  survive in the repo. Create one with placeholder Supabase values plus a real
  `ADMIN_PASSWORD` to boot the dev server. Placeholders are enough for the app to
  start and for pages/auth to work; real DB-backed features (bookings, dashboard
  data) need real Supabase credentials. See `docs/ENV.md` for the full variable
  list. Minimal working set:
  - `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder_anon_key`
  - `SUPABASE_SERVICE_ROLE_KEY=placeholder_service_role_key`
  - `ADMIN_PASSWORD=<any-dev-password>`
- **Do NOT run `npm run build` while `npm run dev` is running.** They share the
  `.next` directory; a concurrent build corrupts the dev server (it then returns
  HTTP 500). If this happens: stop dev, `rm -rf .next`, then restart `npm run dev`.
- **Admin smoke test without a database:** the legacy admin login accepts just
  `ADMIN_PASSWORD` (POST `/api/admin/login` with `{"password":"..."}`, or the
  `/admin/login` page) and logs in as `owner` with no Supabase call. This is the
  quickest end-to-end check that the app is wired up.
- **Playwright e2e** needs the browser installed first (`npm run test:e2e:install`)
  and starts its own server via `npm run start` (production build). The admin e2e
  cases are skipped unless `E2E_ADMIN_PASSWORD` is set.
- Sentry, Upstash rate limiting, and LINE integrations all no-op / fail-open when
  their env vars are unset, so they do not block local dev.
