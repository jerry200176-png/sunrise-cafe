# Developer Onboarding — Sunrise Cafe

**Goal:** New engineer or agent productive on day 1.

---

## Prerequisites

- Node.js **20** (matches CI)
- npm **10+**
- Git
- Supabase project access (for full integration testing)
- LINE Developer accounts (optional for local LINE testing)

---

## Quick Start (15 minutes)

```bash
git clone <repo-url>
cd sunrise-cafe
npm run setup          # install deps + copy .env.example if missing
# Edit .env.local — see docs/ENV.md
npm run verify:env     # check required vars (warn-only locally)
npm run dev            # http://localhost:3000
```

**Admin:** http://localhost:3000/admin/login — password from `ADMIN_PASSWORD`

---

## Environment Setup

1. Copy template: `cp .env.example .env.local` (or use `npm run setup`)
2. Fill **minimum** for local dev:

| Variable | Required local | Notes |
|----------|----------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server routes |
| `ADMIN_PASSWORD` | Yes | Admin login |

3. Optional integrations:

| Variable | Enables |
|----------|---------|
| `LINE_*` | LINE push / webhook / OAuth |
| `UPSTASH_*` | Rate limiting (off if unset) |
| `NEXT_PUBLIC_SENTRY_DSN` | Error tracking |
| `CRON_SECRET` | Local cron route testing |

Full reference: **`docs/ENV.md`**

---

## Repository Map

| Path | Purpose |
|------|---------|
| `src/app/book/` | Guest booking |
| `src/app/admin/` | Back office |
| `src/app/api/` | REST handlers |
| `src/lib/` | Business logic (start here for changes) |
| `supabase/migration-*.sql` | DB changes |
| `docs/` | Architecture, runbooks, ADRs |
| `e2e/` | Playwright tests |
| `CLAUDE.md` | AI + operator handbook |

**Governance:** Read `docs/PLATFORM_GOVERNANCE.md` before cross-domain changes.

---

## Daily Commands

```bash
npm run dev              # Dev server
npm test                 # Unit tests (Vitest)
npm run test:watch       # Watch mode
npm run lint             # ESLint
npm run build            # Production build
npm run verify:migrations # Manifest ↔ SQL files
npm run verify:env       # Env validation
npm run test:e2e         # Playwright (after build)
```

---

## Making Changes

### Feature workflow

1. Branch: `cursor/<feature>-3a90` or `feat/<name>`
2. Implement in `src/lib/` first, thin route in `src/app/api/`
3. Add/update tests in `*.test.ts`
4. Update `CHANGELOG.md` if user-visible
5. PR → CI must pass (lint, test, build, gitleaks)

### Database workflow

1. Create `supabase/migration-<name>.sql`
2. Include `schema_migrations` INSERT
3. Run `npm run sync:migrations`
4. Apply in Supabase SQL Editor (staging first)
5. Update `docs/MIGRATIONS.md` checklist
6. See **`docs/DATABASE_EVOLUTION.md`**

### AI agents

Follow **`docs/AI_AGENT_GOVERNANCE.md`** — reading order, forbidden paths, test requirements.

---

## Debugging Workflow

| Problem | Where to look |
|---------|---------------|
| Booking 409 conflict | `slot-conflict.ts`, overlap migration applied? |
| Admin 401 | `middleware.ts`, `admin-api-auth.ts`, cookies |
| LINE not sending | `docs/LINE.md`, `/api/admin/diagnose-line` |
| Wrong time display | `datetime.ts` — always `toTaipei` |
| Cron not running | Vercel crons + `CRON_SECRET` |
| Schema errors | `/api/admin/schema/status` |
| Payment not marking | `webhooks/line`, `payment_keywords` in settings |

**Logs:** Vercel Functions logs; Sentry if configured.

**Local API test:**
```bash
curl -s http://localhost:3000/api/version | jq
```

---

## Deploy Checklist

See **`docs/RELEASE.md`**. Summary:

1. Migrations applied + `schema_migrations` updated
2. `npm test` + `npm run build` green
3. Vercel env vars match `docs/ENV.md`
4. Redeploy after env changes
5. Verify `/api/version` commit SHA

---

## Getting Help

| Topic | Doc |
|-------|-----|
| Architecture | `docs/ARCHITECTURE.md` |
| Decisions | `docs/DECISIONS.md` |
| Operations | `docs/RUNBOOK.md` |
| Security | `docs/SECURITY_REVIEW_CHECKLIST.md` |
| Staging | `docs/STAGING.md` |

---

## Related

- `docs/ENV.md`
- `scripts/setup-dev.sh`
- `docs/AI_AGENT_GOVERNANCE.md`
