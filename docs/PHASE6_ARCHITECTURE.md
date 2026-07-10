# Phase 6 — Platform Governance & Scale Readiness

**Date:** 2026-07-10  
**Goal:** Ensure Sunrise Cafe can safely grow for years with multiple developers, AI agents, and dozens of branches.

---

## 1. Platform Maturity Assessment

| Dimension | Current (post Phase 5) | Target (Phase 6) | Gap |
|-----------|------------------------|------------------|-----|
| **Architecture clarity** | Strong docs, monolithic coupling | Documented domains + dependency rules | Extract shared ops libs; reduce god-module imports |
| **Database lifecycle** | 29 manual migrations, `schema_migrations` table | Manifest + CI verification + admin drift API | Automated manifest sync; index/retention migrations |
| **AI-assisted dev** | `CLAUDE.md` operator handbook | Formal agent governance | Reading order, forbidden paths, review checklist |
| **Security** | Dual auth, rate limit, gitleaks CI | Phase 6 maturity review + tracked findings | Close P0 catalog mutations; audit dependency posture |
| **Multi-branch** | DB-driven `line_group_id`, branch scoping | 50-branch failure analysis | N+1 cron queries, no branch RBAC, single admin password |
| **Developer experience** | `ENV.md`, scattered setup | Onboarding + setup scripts + env validation | `npm run setup`, `npm run verify:env` |

**Overall maturity:** **B** — production-viable for a small multi-branch café; governance documentation exceeds typical startup stage, but **implementation boundaries** and **automated schema governance** lag documentation.

---

## 2. Scaling Risks

### Critical (address before 50 branches / adversarial traffic)

| Risk | Symptom at scale | Mitigation |
|------|------------------|------------|
| **`supabase-admin.ts` god module** | Every schema change breaks 30+ routes | Domain modules; dependency rules (Phase 6) |
| **Unauthenticated catalog APIs** | Branch/room price tampering | Auth on `POST/PATCH/DELETE` branches & rooms (tracked P0) |
| **Cron full-table scans** | Timeouts at 100k+ reservations | Indexes (Phase 6 migration); batch pagination |
| **Manual migration drift** | Staging ≠ production schema | Manifest + `/api/admin/schema/status` |
| **Single admin password** | No per-branch operator isolation | Document limitation; plan RBAC for Phase 7+ |
| **Analytics unbounded growth** | Slow BI queries, storage cost | Retention function + maintenance cron |

### High (plan within 12 months)

| Risk | Mitigation |
|------|------------|
| Morning-summary logic duplicated | Shared `morning-summary-context.ts` |
| BI API single-query-per-period | Materialized views or caching at 10k+ bookings/90d |
| Rate limit fail-open without Upstash | Require Upstash in production checklist |
| ADR/doc drift (e.g. ADR-003 multi-branch) | Quarterly doc reconciliation in governance review |
| `print-bridge` single-machine | Document as non-scalable; optional cloud print later |

### Medium

| Risk | Mitigation |
|------|------------|
| No dedicated staging DB | `STAGING.md` + env validation |
| Supabase free tier pause | Uptime ping; paid tier before commercial scale |
| E2E coverage gaps on admin ops | Expand smoke tests when ops UI changes |

---

## 3. Governance Proposal

### 6-1 Architecture Governance

- **`docs/PLATFORM_GOVERNANCE.md`** — architecture map, domain boundaries, dependency rules, ownership model
- **Rule:** `src/lib/*` must not import from `src/app/*`; cross-domain via explicit facades
- **Rule:** New cron logic lives in `src/lib/`; routes are thin wrappers
- **Quarterly:** Architecture review against dependency rules

### 6-2 Database Evolution Strategy

- **`supabase/migrations.manifest.json`** — canonical ordered migration list
- **`scripts/verify-migrations.sh`** — manifest ↔ filesystem ↔ CI
- **`GET /api/admin/schema/status`** — runtime drift detection vs `schema_migrations`
- **`docs/DATABASE_EVOLUTION.md`** — retention, index policy, rollout playbook
- **Phase 6 migrations:** scale indexes + analytics retention function

### 6-3 AI Agent Development Governance

- **`docs/AI_AGENT_GOVERNANCE.md`** — reading order, forbidden blind edits, test/migration rules
- **Agents must:** run `npm test` + `npm run verify:migrations` before PR
- **Agents must not:** run destructive `schema.sql`; apply migrations only via numbered files

### 6-4 Security Maturity Upgrade

- **`docs/SECURITY_MATURITY_PHASE6.md`** — audit findings with severity + status
- Update **`SECURITY_REVIEW_CHECKLIST.md`** with Phase 6 items
- CI: `npm run verify:env` in lint job (placeholder mode)

### 6-5 Multi-Branch Readiness

- **`docs/MULTI_BRANCH_SCALE.md`** — "50 branches" failure modes + mitigations

### 6-6 Developer Experience

- **`docs/ONBOARDING.md`** — day-1 developer path
- **`scripts/setup-dev.sh`**, **`scripts/verify-env.sh`**
- **`npm run setup`**, **`npm run verify:env`**, **`npm run verify:migrations`**

---

## 4. Implementation Roadmap

| Priority | ID | Deliverable | Status |
|----------|-----|-------------|--------|
| P0 | 6-1 | `PLATFORM_GOVERNANCE.md` | Phase 6 |
| P0 | 6-2 | Migration manifest + verify scripts + schema status API | Phase 6 |
| P0 | 6-3 | `AI_AGENT_GOVERNANCE.md` | Phase 6 |
| P0 | 6-4 | `SECURITY_MATURITY_PHASE6.md` + checklist update | Phase 6 |
| P1 | 6-2 | Scale indexes + analytics retention migration | Phase 6 |
| P1 | 6-5 | `MULTI_BRANCH_SCALE.md` | Phase 6 |
| P1 | 6-6 | Onboarding + setup/verify scripts | Phase 6 |
| P1 | 6-1 | Extract `morning-summary-context.ts` (dedupe) | Phase 6 |
| P2 | 7+ | Branch-scoped admin RBAC | Future |
| P2 | 7+ | Repository layer per domain | Future |
| P2 | 7+ | Materialized BI views | Future |

---

## Related docs

- `docs/PLATFORM_GOVERNANCE.md`
- `docs/DATABASE_EVOLUTION.md`
- `docs/AI_AGENT_GOVERNANCE.md`
- `docs/MULTI_BRANCH_SCALE.md`
- `docs/ONBOARDING.md`
- `docs/SECURITY_MATURITY_PHASE6.md`
