# Capability Gaps — Evidence-Based Registry

**Owner:** Orchestrator · Planner role  
**Updated:** 2026-07-15 (Maturity A loop-2 — merge done; Vercel deploy quota)  
**Rule:** Gaps require **verified repo or production evidence** — not feature-parity wishlists.  
**Full audit:** [`COMPETITIVE_AUDIT_2026-07-15.md`](./COMPETITIVE_AUDIT_2026-07-15.md)  
**Maturity SSOT:** [`COMMERCIAL_MATURITY_RUBRIC.md`](./COMMERCIAL_MATURITY_RUBRIC.md) · [`COMMERCIAL_MATURITY_A_EVIDENCE.md`](./COMMERCIAL_MATURITY_A_EVIDENCE.md) · [`COMMERCIAL_MATURITY_A_GAPS.md`](./COMMERCIAL_MATURITY_A_GAPS.md)

> Prefer `COMMERCIAL_MATURITY_A_GAPS.md` for the live A-gate matrix. This file is the compact registry.

---

## Open gaps (ranked)

| Rank | ID | Gap | Mature reference | Verified evidence | Proposed action | Owner | Status |
|------|-----|-----|------------------|-------------------|-----------------|-------|--------|
| 1 | CG-008 | Catalog RLS anon write on **production** | Supabase deny-by-default | App live (`/api/payment/status` 200); migrate awaiting Founder APPLY on Environment `Production` | Run maturity migrate → `PROBES_OK` | Founder/Ops | **OPEN** (preflight clear) |
| 2 | CG-012 | Vercel Hobby CLI deploy quota | Continuous deploy | CLI still rate-limited; prod SHA nonetheless reached `f7d81f2` | Optional Pro; prefer fewer preview burns | Founder | **WATCH** |
| 3 | CG-006 | Rate limits not **distributed** | Stripe always-on shared limits | Memory fallback **enforces per isolate** (degraded); Upstash unset → `rate_limit_mode=memory` | Enable Upstash on Vercel; confirm health=`upstash` | Founder | **OPEN** (degraded mitigating) |
| 4 | CG-011 | Backup/DR not drilled with artifacts | Vercel/Supabase PITR | Scripts write dump+sha256+manifest; Pro/PITR unpaid | Run `db:restore-drill` in Environment; Founder Pro optional (cloud drill: `docs/ops/CLOUD_BACKUP_RESTORE_DRILL.md`, pending first dispatch) | Ops/Founder | **OPEN** |
| 5 | CG-002 | North Star contracts not satisfied | Stripe dashboards with SLAs | Contracts API fields added; `ops_events` missing on prod (migration name fix in loop-2) | Apply ops_events → accumulate 7d | Agent/Ops | **OPEN** |
| 6 | CG-009 | Paid-deposit refund money policy | Eatsy tiered refund | Request workflow + SQL ready; legal copy TBD | Founder policy table | Founder | **OPEN** |
| 7 | CG-010 | Stripe deposit capture closed (intentional) | Inline card deposit | `stripeEnabled=false` + `/api/payment/status` | Keep closed until KPI proves ROI | Product | **WATCH** |
| 8 | CG-003 | Optional multi-branch LINE migration | Per-tenant config | env fallback works | Apply when multi-group needed | Ops | **OPEN** optional |
| 9 | CG-007 | E2E admin password for live admin flows | Vercel critical E2E | Booking mocks green; admin today mocked | Set `E2E_ADMIN_PASSWORD` for live path | Founder | **PARTIAL** |

---

## Closed / narrowed (recent)

| ID | Note | Evidence |
|----|------|----------|
| CG-006 (fail-open) | **Narrowed**: silent fail-open removed; memory degraded enforce ships | `rate-limit.ts` + tests; health exposes mode |
| CG-R03 | Payment text auto-approve removed | ADR-008 Phase 2 |
| Half-hour E2E break | Fixed mocks | Playwright CI green on #213 |

---

## Stop list

- Next.js 16 upgrade — DL-012  
- PaymentProvider abstraction — no gateway contract  
- Marketplace / AI phone — ROI unproven  

---

*Do not claim CG-006 closed until production `rate_limit_mode=upstash` (or equivalent distributed store).*
