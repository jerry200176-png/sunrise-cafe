# RBAC — Role-Based Access Control

**Phase 7** · Sunrise Cafe admin authorization.

---

## Roles

| Role | `branch_ids` | Description |
|------|--------------|-------------|
| `owner` | `null` (all) | Platform owner — all branches, user management |
| `branch_manager` | assigned UUIDs | Store manager — operations + campaigns for assigned stores |
| `staff` | assigned UUIDs | Floor staff — reservations status, orders |
| `finance` | assigned UUIDs | Finance — payments and revenue visibility |

---

## Permissions

| Permission | owner | branch_manager | staff | finance |
|------------|:-----:|:--------------:|:-----:|:-------:|
| `*` (all) | ✅ | | | |
| `reservations:read` | ✅ | ✅ | ✅ | |
| `reservations:write` | ✅ | ✅ | | |
| `reservations:write_status` | ✅ | ✅ | ✅ | |
| `reservations:cancel` | ✅ | ✅ | | |
| `payments:read` | ✅ | | | ✅ |
| `payments:approve` | ✅ | | | ✅ |
| `branches:read` | ✅ | ✅ | | |
| `branches:write` | ✅ | | | |
| `rooms:read` | ✅ | ✅ | | |
| `rooms:write` | ✅ | | | |
| `bi:read` | ✅ | ✅ | | ✅ |
| `ops:read` | ✅ | ✅ | ✅ | |
| `customers:read` | ✅ | ✅ | | |
| `campaigns:read` | ✅ | ✅ | | |
| `campaigns:write` | ✅ | ✅ | | |
| `users:manage` | ✅ | | | |
| `audit:read` | ✅ | | | |
| `orders:read` | ✅ | ✅ | ✅ | |
| `orders:write` | ✅ | ✅ | ✅ | |
| `settings:write` | ✅ | | | |

---

## Branch scope rules

1. **owner** — `canAccessBranch(ctx, anyId)` → true
2. **Others** — branch must be in `ctx.branch_ids`
3. **No assignment** — deny scoped operations (empty array)
4. **API pattern** — `requirePermission(request, 'bi:read', branchId)`

---

## Legacy authentication

`ADMIN_PASSWORD` login (no email) issues:

```json
{ "role": "owner", "legacy": true, "branch_ids": null }
```

Existing cookies without `role` claim are treated as **owner** (backward compatible).

---

## User management

- `GET/POST /api/admin/users` — owner only
- `PATCH /api/admin/users/[id]` — owner only (role, branches, active)
- `GET /api/admin/me` — any authenticated admin

Passwords stored as **scrypt** hash (`admin_password.ts`). Never log or return hashes.

---

## Audit

Permission changes write to `admin_permission_audit` via `writePermissionAudit()`.

---

## Related

- `docs/PHASE7_ARCHITECTURE.md`
- `src/lib/rbac.ts`
