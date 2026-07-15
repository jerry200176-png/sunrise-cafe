# Commercial Maturity A — Evidence Board

**Rubric (frozen):** `COMMERCIAL_MATURITY_RUBRIC.md`  
**Baseline (frozen):** `COMMERCIAL_MATURITY_BASELINE_2026-07-15.md`  
**Rule:** Append scorecard rows; never overwrite baseline grades.

---

## Loop 1 — 2026-07-15 (branch `cursor/commercial-maturity-a-a33b`)

### Before → After (dimensions touched)

| ID | Baseline | After loop-1 | Change shipped | Prod evidence | Metric evidence | Residual risk |
|----|----------|--------------|----------------|---------------|-----------------|---------------|
| D01 | B+ | **B+ → pending A−** | E2E half-hour mock fixed; booking path unchanged | Prod SHA still `cfc940b` until merge | E2E 18/18 local | Needs deploy |
| D02 | B− | **B** | Stripe UI closed (`stripeEnabled=false` + `/api/payment/status`); refund_request API + policy model | create-intent already 503 on prod [FACT] | Unit tests policy | refund SQL not applied; Founder policy |
| D03 | B− | **B** | `/admin/today` + `/api/admin/today` | Not on prod yet | Build includes routes | Needs staff verify on phone after deploy |
| D05 | B− | **B** (code) / **B−** (prod) | Service-role writes + RLS migration file; `deniedContext`; memory rate-limit (no fail-open) | Prod RLS **not** applied [FACT — no real DB URL in agent] | Unit + static RLS tests; memory limiter rejects 6th login | Apply SQL after deploy; Upstash preferred |
| D06 | C | **C+** | `db:backup` / `db:restore-drill` scripts + ops doc | Drill blocked: placeholder DB URL [FACT] | Scripts refuse placeholder | Founder Pro/PITR + real URL |
| D07 | C+ | **B−** | Funnel events expanded; health exposes `rate_limit_mode` | Funnel posts OK locally | Forward baseline only | Need 7d Observed after deploy |
| D09 | B+ | **A−** (local) | Playwright green after mock fix | CI pending on PR | 257 unit + 18 e2e | Vercel Hobby preview rate-limit external |
| D10 | C+ | **B−** | `refund_requests` migration + guest API | Table not on prod | Insert fails closed with 503 if missing | Apply SQL |

### Whole-product grade after loop-1

**Still B− / B (not A).**  
Reasons (gate):

1. Catalog RLS **not verified on production** (P0 open in prod)  
2. Backup restore drill **not executed** against real DB  
3. KPI Observed still mostly unmeasured in production  
4. Today ops / refund workflow not production-verified  

Honest: **do not claim A.**

### A Gate checklist (loop-1)

| Gate | Status |
|------|--------|
| No untreated P0 | ❌ prod RLS + backup |
| RLS + negative tests | ✅ code/static; ❌ prod probe |
| Rate limit enforce | ✅ memory mode in code; 🟡 Upstash unset |
| Backup + restore path | 🟡 scripts; ❌ real drill |
| Core booking E2E | ✅ local 18 passed |
| Deposit capture clear state | ✅ Stripe fully closed (manual_review) |
| Cancel/refund no high-risk silence | 🟡 request workflow; paid still not self-cancel |
| Today ops | ✅ code; ❌ prod verify |
| North Star real data | ❌ |
| Cron/deploy monitors | ✅ prior |
| Prod SHA = main | ✅ currently; will need re-check after merge |
| No dangerous half-finished UX | ✅ Stripe modal gated off |

### Evidence links (loop-1)

| Kind | Ref |
|------|-----|
| Branch | `cursor/commercial-maturity-a-a33b` |
| Includes prior harden | from `cursor/competitive-audit-rls-harden-a33b` @ `6107126` |
| Unit tests | `npm test` → 257 passed |
| E2E | `npm run test:e2e -- e2e/booking-flow.spec.ts e2e/qa-audit.spec.ts` → 18 passed |
| Migrations | `migration-rls-catalog-read-only.sql`, `migration-refund-requests.sql` |
| Founder queue | #211 |

### Founder Decision Queue (updated)

| ID | Decision | Suggested default | Cost | Risk if deferred | Deadline | Agent prep done |
|----|----------|-------------------|------|------------------|----------|-----------------|
| FD-3 | Apply RLS catalog SQL after this PR deploys | Immediately after admin CRUD check | 0 | Public anon write remains | At deploy | Script `npm run db:apply-rls-catalog`; code uses service role |
| FD-2 | Upstash | Enable | Low $/mo | Multi-instance memory limits diverge | 7d | Memory degraded mode already enforces |
| FD-1 | Supabase backups/Pro | Min auto-backup | $ | Data loss | 14d | `db:backup` + restore drill doc |
| FD-4 | Refund money rules | Tiered ≥48h staff review | Policy time | Legal/CX | 14d | `cancel-refund-policy` + `refund_requests` ready |
| FD-5 | Stripe go-live | Keep closed until KPI | Fees | Trust if half-open | After baseline | Stripe fully closed |
| — | Inject real `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_DB_URL` for agents/CI | Required for apply/drill | Secret ops | Agent cannot close P0 in prod | Immediate | Placeholders detected & refused |

---

## Next loop focus

1. Merge + deploy this PR  
2. Founder/ops: real DB URL → apply RLS + refund migration + restore drill  
3. Measure funnel/north-star for 7 days  
4. Staff phone-test `/admin/today`  
5. Re-grade with production probes only
