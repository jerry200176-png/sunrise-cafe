# Release Process — Sunrise Cafe

## Before every production release

### 1. Code quality
- [ ] All CI checks green (lint, test, build, e2e)
- [ ] CHANGELOG updated under new version section
- [ ] No `continue-on-error` failures ignored without reason

### 2. Database migrations
- [ ] New migrations listed in `docs/MIGRATIONS.md`
- [ ] Run `scripts/verify-migrations.sh` locally
- [ ] Pre-check queries passed in Supabase SQL Editor
- [ ] `schema_migrations` table updated after apply

### 3. Environment variables
- [ ] New env vars documented in `docs/ENV.md`
- [ ] Vercel production/preview variables set
- [ ] `SESSION_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET` verified

### 4. Smoke tests (post-deploy)
- [ ] `/api/version` matches deployed commit (auto via `verify-production` workflow)
- [ ] Guest booking flow (manual or E2E against staging)
- [ ] Admin login + dashboard loads
- [ ] `/api/booking-health` returns `{ ok: true }`

### 5. Rollback plan
- [ ] Previous Vercel deployment ID noted
- [ ] DB migrations: document if rollback requires constraint drop
- [ ] Promote previous deployment in Vercel if needed

## Versioning

- **RC tags** for release candidates: document in `docs/releases/`
- **Production changelog**: `CHANGELOG.md` on merge to `main`

## Production change log

After each deploy, append to `CHANGELOG.md` with:
- Date
- Commit SHA
- Migration steps executed (yes/no + which)
- Any manual ops performed

## Automated checks

| Check | When |
|-------|------|
| GitHub Actions CI | Every PR + push to main |
| Playwright E2E | CI (mocked APIs) |
| verify-production | Push to main |
| gitleaks | CI (blocking) |

## Incident response

See `docs/RUNBOOK.md` and `docs/incidents/` for postmortem template.
