# Multi-Branch Scale Analysis — "What breaks at 50 branches?"

**Sunrise Cafe** · Phase 6 readiness assessment.

---

## Executive Answer

At **50 branches** with current architecture, the system **remains functionally correct** for booking and per-branch LINE reminders, but **operational UX, cron performance, and admin security** become the primary failure modes—not database correctness.

| Area | 1–3 branches (today) | 50 branches (projected) | Breaks? |
|------|----------------------|-------------------------|---------|
| Booking correctness | ✅ Overlap constraint + app check | ✅ Same | No |
| Per-branch LINE reminders | ✅ `line_group_id` loop | ✅ 50 group pushes/cron | Slow, not broken |
| Admin reservation list | ✅ Branch switcher | ⚠️ Manual switching; no unified inbox | Ops pain |
| Admin auth | ✅ Single password | ❌ No branch-scoped roles | Security gap |
| BI / reporting | ✅ By-branch breakdown | ⚠️ Heavy queries, no cache | Slow dashboards |
| Morning summary cron | ✅ 1–3 iterations | ⚠️ 50× room fetches (N+1) | Timeout risk |
| Demand collect cron | ✅ Daily per branch | ⚠️ Large upsert batches | Slow |
| Settings / config | ✅ Global + per-branch | ⚠️ No config versioning | Human error |
| Ordering / QR | ✅ Per branch | ✅ Scales with `branch_id` | No |
| print-bridge | 1 store PC | ❌ 50 stores = 50 bridges | Not centralized |

---

## Branch Isolation

### What is isolated today

- **Data:** `rooms.branch_id`, `orders.branch_id`, `demand_snapshots.branch_id`
- **LINE groups:** `branches.line_group_id` — each branch gets its own digest
- **Payment copy:** `display_name`, `payment_info`, `line_pay_url` per branch
- **Analytics:** Optional `branch_id` dimension

### What is NOT isolated

- **Admin session:** One password sees all branches
- **Guest APIs:** No branch-level rate limit tiers
- **Cron failures:** One branch error can delay others in same job (sequential loops)
- **Reservations:** No `branch_id` column — must join through `rooms` (extra query cost)

### Recommendation

| Priority | Change |
|----------|--------|
| P1 | Add composite indexes (Phase 6 migration) |
| P1 | Batch room fetches in crons (`WHERE branch_id IN (...)`)
| P2 | Denormalize `reservations.branch_id` at 20+ branches |
| P2 | Branch-scoped admin roles (Phase 7+) |
| P3 | Per-branch cron fan-out (separate Vercel cron per region) |

---

## Permissions

**Current model:** Binary — public guest, authenticated admin (all branches).

**50-branch gap:**
- Regional managers should not edit other branches' prices
- Store staff should not see payment audit for all stores
- No audit log of which admin changed which branch

**Interim controls:**
- Separate Vercel projects per franchise (heavy-handed)
- Operational policy: single shared admin account (weak)
- **Target:** `admin_users` table with `branch_ids[]` scope (future)

---

## Reporting

| Report | 50-branch behavior | Mitigation |
|--------|-------------------|------------|
| `/admin/insights` | Aggregates all branches; query time grows | Cache daily KPIs; `days` default 30 → 7 for overview |
| `/admin/ops` | Single morning summary for all | Per-branch summary option |
| `demand_snapshots` | 50 × rooms × hours rows/day | Acceptable; ~thousands of rows/day |
| Export / CSV | Not implemented | Do not add bulk PII export |

---

## Performance Projections

Assumptions: 50 branches, 4 rooms each, 200 bookings/branch/month.

| Workload | Volume | Risk |
|----------|--------|------|
| Reservations | ~120k active rows | OK with indexes |
| Analytics events | ~2M/year | **Retention required** |
| Deposit cron scan | ~5k unpaid rows peak | OK with deposit index |
| `fetchReservationsAdmin` | 200 rows × manual switch | UX not perf |
| BI 90-day query | Full table scan on analytics | Needs retention + index |

**First timeout likely in:** `morning-summary` or `send-line` cron (sequential branch loops + room fetches).

---

## Operational Workflows

| Workflow | 50-branch pain | Mitigation |
|----------|----------------|------------|
| Onboard new branch | Manual: branch, rooms, LINE group, payment info | Checklist in `RUNBOOK.md` |
| Rotate LINE token | Update env + all webhooks | Per-branch tokens (future) |
| Deposit deadline | One cron, all branches | Already multi-branch |
| Payment review | Single `/admin/payments` queue | Filter by branch (future) |
| Closed dates | Global `settings.closed_dates` | **Breaks** — should be per-branch |
| Public holidays | Same for all stores | Per-branch `closed_dates` migration needed |

---

## Action Items (Phase 6)

- [x] Document failure modes (this doc)
- [x] Scale indexes migration
- [x] Analytics retention for long-term BI
- [x] Schema governance to prevent env drift
- [ ] Per-branch `closed_dates` (Phase 7)
- [ ] Admin branch filter on payments queue (Phase 7)
- [ ] Cron batching refactor (Phase 7)

---

## Related

- `docs/PLATFORM_GOVERNANCE.md`
- `docs/DATABASE_EVOLUTION.md`
- `docs/OPERATIONS_AUTOMATION.md`
