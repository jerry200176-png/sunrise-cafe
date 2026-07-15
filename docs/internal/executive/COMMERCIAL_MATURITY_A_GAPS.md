# Commercial Maturity A — Gap Matrix (live)

**Rubric:** `COMMERCIAL_MATURITY_RUBRIC.md`  
**Baseline:** `COMMERCIAL_MATURITY_BASELINE_2026-07-15.md` (frozen)  
**Updated:** 2026-07-15 loop-1

| ID | Dim | Now | Target | Root cause | User impact | Biz/ops | Security/data | Fix | Cost | Deps | Accept evidence | Autonomous? |
|----|-----|-----|--------|------------|-------------|---------|---------------|-----|------|------|-----------------|-------------|
| G05 | D05 | B− | A− | catalog anon WRITE still on prod; harden only on branch | Trust/integrity | High | **P0** | Merge + deploy service-role writes → `db:apply-rls-catalog` | S | Real `SUPABASE_DB_URL` | anon PATCH fails; admin CRUD ok | Partial — apply needs real DB URL |
| G06 | D06 | C | A− | No verified backup/restore | Catastrophic loss | Existential | **P0** | `db:backup` + restore drill with real URL; Founder enable PITR/Pro | S+$ | Paid plan decision | DRILL_RESULT=pass | Script ✅; Pro Founder |
| G07a | D07 | C+ | A− | Funnel thin; Observed often null | Can't prioritize | Waste eng | Low | Expand funnel events + integrity flags on north-star | S | ops_events table | Observed ≠ null for ≥3 metrics forward | ✅ |
| G02a | D02 | B− | A− | Stripe modal vs 503; paid cancel phone-only | Confusion / phone load | Revenue/CX | Medium | Close Stripe UI; refund_request workflow | S–M | refund migration | `/api/payment/status` false; no modal; refund API | ✅ code; SQL apply needs URL |
| G03 | D03 | B− | A− | Multi-page staff ops | Slow peak shifts | Labor | Low | `/admin/today` bundle | M | — | Mobile task completion fewer hops | ✅ |
| G05b | D05 | B− | A− | Rate limit was fail-open | Abuse | Stability | **P0** | Memory degraded enforce when no Upstash | S | Prefer Upstash | health `rate_limit_mode` memory/upstash; 429 under burst | ✅ memory; Upstash Founder |
| G10 | D10 | C+ | B+ | No refund_requests / audit table | Dispute slow | Risk | Medium | migration-refund-requests + API | S | SQL apply | rows insertable | Partial |
| G08 | D08 | B | B+ | CWV unmeasured | Perf unknown | CX | Low | Add web-vitals report later | S | — | LCP sample | Later |
| G09 | D09 | B+ | A− | E2E half-hour mock break | CI red | Delivery | Low | Fix mock half-hour slots | S | — | Playwright green | ✅ |

## Priority order this loop

1. E2E fix (unblock merge)  
2. Stripe binary close + rate-limit memory  
3. RLS code path (already on branch) + apply script  
4. Today ops  
5. Refund request model  
6. Funnel/KPI telemetry  
7. Backup/restore scripts  

## Founder blockers (cannot fake)

| Item | Why |
|------|-----|
| Real Supabase service role + DB URL in agent/CI | Current secrets are placeholders (`[ref]` / 18-char key) |
| Upstash | For multi-instance rate limits |
| Supabase Pro/PITR | True DR |
| Final refund money policy | Legal |
