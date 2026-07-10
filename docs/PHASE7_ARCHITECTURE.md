# Phase 7 — Enterprise Operations & Multi-Branch Platform

**Date:** 2026-07-10  
**Goal:** Evolve from a strong single-company platform into a multi-branch hospitality operating system (50+ branches).

---

## 1. Enterprise Architecture Assessment

| Capability | Post Phase 6 | Post Phase 7 target | Gap closed |
|------------|--------------|---------------------|------------|
| **Identity** | Single `ADMIN_PASSWORD` | Users + roles + branch scopes | RBAC tables + session claims |
| **Authorization** | Binary admin | Permission checks per API | `requirePermission()` |
| **Branch config** | Global `settings.closed_dates` | Per-branch `closed_dates` + ops config | `branches` columns |
| **Domain coupling** | `supabase-admin.ts` hub | Documented domain facades | `src/lib/domains/*` |
| **Insight → action** | Retention opportunities list | Tracked business actions | `business_actions` table |
| **Audit** | Payment log only | Admin + permission audit | `admin_audit_logs` |
| **Cron scale** | Sequential branch loops | Batched processing + job runs | `job_runs` + `cron-batch.ts` |
| **Reporting isolation** | All branches in BI | Filter by user's branch scope | BI API branch filter |

**Maturity grade:** B → **B+** after Phase 7 foundations (full A- requires RBAC on all routes + materialized BI at scale).

**Architectural stance:** Incremental evolution — **no big-bang rewrite**. Legacy `ADMIN_PASSWORD` login remains as owner-equivalent until operators migrate users.

---

## 2. RBAC Proposal

### Roles

| Role | Branch scope | Capabilities |
|------|--------------|--------------|
| **owner** | All branches (`branch_ids = null`) | Full platform control, user management |
| **branch_manager** | Assigned branches | Reservations, ops, campaigns, BI (scoped) |
| **staff** | Assigned branches | Day-of operations: status updates, orders |
| **finance** | Assigned branches | Payments, revenue reports — no catalog edits |

### Permission model

- Permissions are **strings** in code: `reservations:read`, `payments:approve`, `users:manage`, etc.
- Roles map to permission sets in `src/lib/rbac.ts` (versioned with code, not DB ACL explosion).
- Branch scope enforced via `admin_user_branches` join table.
- **Secure by default:** unknown role → no permissions; missing branch assignment → deny scoped actions.

### Session claims

```json
{
  "sub": "user-uuid",
  "role": "branch_manager",
  "branch_ids": ["branch-a", "branch-b"],
  "exp": 1234567890
}
```

Legacy password sessions: `{ "role": "owner", "legacy": true }` — full access until migrated.

### Audit

`admin_permission_audit` records: user created, role changed, branches updated, deactivated.

---

## 3. Migration Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| RBAC tables missing in prod | Login falls back to legacy password only | Graceful degradation; `migration_required` flags |
| Existing sessions invalidated | Admins logged out once | Session payload backward-compatible (no `role` → owner) |
| Branch-scoped BI surprises | Manager sees fewer branches than expected | `/api/admin/me` exposes scope; UI branch filter |
| `closed_dates` move global → branch | Wrong dates if not migrated | Migration copies `settings.closed_dates` to all branches |
| `reservations.branch_id` backfill | Nullable until backfilled | Cron joins still work via `room_id` |
| Password hash algorithm change | Users cannot login | Single scrypt format documented; no migration of legacy password to user row until bootstrap |

**Rollback:** RBAC is additive — disable user login path; `ADMIN_PASSWORD` continues to work.

---

## 4. Incremental Roadmap

| Sprint | ID | Deliverable |
|--------|-----|-------------|
| **7-1** | RBAC | Tables, `rbac.ts`, extended session, login, `/api/admin/users`, `/api/admin/me` |
| **7-2** | Domains | `src/lib/domains/{booking,payment,customer,analytics,operations}.ts` facades |
| **7-3** | Multi-branch | Per-branch `closed_dates`, branch scope in BI/ops APIs, `branch_id` on reservations |
| **7-4** | Action loop | `business_actions` + recommendations helper + admin API |
| **7-5** | Reliability | `admin_audit_logs`, `job_runs`, `cron-batch.ts`, morning-summary batch rooms |
| **7-UI** | Admin | `/admin/users` management page, permission-aware nav (future tighten) |

**Deferred Phase 8+:** SSO/OIDC, fine-grained DB RLS per admin user, multi-tenant franchise billing.

---

## Related

- `docs/RBAC.md` — permission reference
- `docs/PLATFORM_GOVERNANCE.md` — domain boundaries (updated)
- `docs/MULTI_BRANCH_SCALE.md` — 50-branch analysis
