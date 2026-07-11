# Implementation Truth — Single Source of Technical State

**Owner:** CTO Operating System v2  
**Updated:** 2026-07-11 (Round 6)  
**Rule:** If this doc disagrees with other docs, **this doc wins**. Verify against `main` branch code.  
**Daily ops:** [`EXECUTIVE_DASHBOARD.md`](./EXECUTIVE_DASHBOARD.md) · snapshot: `npm run cto:snapshot`

---

## Production

| Item | Value |
|------|-------|
| URL | https://sunrise-cafe-six.vercel.app |
| Branch | `main` |
| Release tag | `v2.2.0` |
| Verify | `GET /api/version` → `commit` SHA |

---

## Enforced in Code (✅ = on `main`)

| Capability | Status | Evidence |
|------------|--------|----------|
| Admin session on `/api/admin/*` | ✅ | `middleware.ts` |
| Deny-by-default admin in production | ✅ | #69 |
| Server-side booking price/status | ✅ | #69 |
| Guest phone + booking_code auth | ✅ | #79 |
| Double-book app handling | ✅ | #79 |
| RBAC tables + login | ✅ | #81 |
| RBAC payment routes | ✅ | #82 |
| RBAC reservation routes | ✅ | #85 `reservation-access.ts` |
| Per-branch `closed_dates` | ✅ | #86 `branch-closed-dates.ts` |
| Cron failure alerting | 🟡 | #87 pending |
| `verify:migrations` in CI | ❌ | Not in package.json |

---

## Database Migrations (manual apply)

| Migration | Required | Applied? |
|-----------|----------|----------|
| `migration-schema-versions.sql` | Yes | Operator verify |
| `migration-reservations-no-overlap.sql` | Yes (#79) | Pending |
| `migration-phase7-rbac.sql` | Yes (#81) | Pending |
| `migration-branches-closed-dates.sql` | After #86 | Pending |

Check: `SELECT * FROM schema_migrations ORDER BY applied_at;`

---

## Open GitHub State

| Type | Count | Action |
|------|-------|--------|
| Open PRs | #86 (wave3b), #64/#65 dependabot, #70–#77 stale | Close #70–77 manually |
| Open Issues | 7 | Triage in dashboard |
| Tests on main | 129 | — |

---

## Priority Stack (company value order)

1. **Production stability** — migrations applied
2. **Security** — ✅ reservation RBAC (#85)
3. **Revenue** — deposit flow, waitlist
4. **Customer experience** — per-branch closed dates (#86)
5. **Developer experience** — dashboard SSOT, snapshot script

---

*Updated each engineering round in `docs/EXECUTIVE_DASHBOARD.md`.*
