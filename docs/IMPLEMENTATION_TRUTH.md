# Implementation Truth — Single Source of Technical State

**Owner:** CTO Operating System  
**Updated:** 2026-07-10 (Round 3)  
**Rule:** If this doc disagrees with other docs, **this doc wins**. Verify against `main` branch code.

---

## Production

| Item | Value |
|------|-------|
| URL | https://sunrise-cafe-six.vercel.app |
| Branch | `main` |
| Release tag | `v2.1.0` |
| Verify | `GET /api/version` → `commit` SHA |

---

## Enforced in Code (✅ = on `main`)

| Capability | Status | Evidence |
|------------|--------|----------|
| Admin session on `/api/admin/*` | ✅ | `middleware.ts` |
| Admin-only catalog mutations | ✅ | `isAdminOnlyApiPath()` RC2-P2 |
| Deny-by-default admin in production | ✅ | `isAdminAuthRequired()` #69 |
| Server-side booking price/status | ✅ | `reservations/route.ts` POST #69 |
| Guest phone + booking_code auth | ✅ | `guest-auth.ts` #79 |
| Double-book app handling | ✅ | `slot-conflict.ts` #79 |
| RBAC tables + login | ✅ | #81 |
| RBAC payment routes | ✅ | #82 |
| RBAC reservation routes | ❌ | Wave 3 |
| Per-branch `closed_dates` | ❌ | Column may exist in DB; code reads `settings.closed_dates` |
| Audit log on mutations | ❌ | `writeAdminAuditLog` unused |
| Cron job fan-out | ❌ | Sequential loops; `job_runs` not on main |
| `verify:migrations` in CI | ❌ | Script not in `package.json` on main |

---

## Database Migrations (manual apply)

**On `main` migration files:** 25 (including phase7-rbac in Wave 2 PR)

### Required for current production code

| Migration | Required | Applied? |
|-----------|----------|----------|
| `migration-schema-versions.sql` | Yes | Operator verify |
| `migration-reservations-no-overlap.sql` | Yes (#79) | Operator verify |
| `migration-phase7-rbac.sql` | After Wave 2 merge | Pending |

Check: `SELECT * FROM schema_migrations ORDER BY applied_at;`

---

## Open GitHub State

| Type | Count | Action |
|------|-------|--------|
| Open PRs | #64, #65 (dependabot), #70–#77 (stale drafts) | Close #70–77 manually; fix #64/#65 |
| Open Issues | 7 (#54 epic + 6 enhancements) | Triage in dashboard |
| Stale remote branches | dependabot only (cursor/* deleted) | — |

---

## Priority Stack (company value order)

1. **Production stability** — migrations applied, CI green, deploy verified
2. **Security** — RBAC enforcement on payments/reservations (Wave 2b)
3. **Revenue** — deposit collection reliability, waitlist conversion
4. **Customer experience** — per-branch closed dates, admin role nav
5. **Developer experience** — dashboard SSOT, migration CI

---

*Updated each engineering round in `docs/ENGINEERING_DASHBOARD.md`.*
