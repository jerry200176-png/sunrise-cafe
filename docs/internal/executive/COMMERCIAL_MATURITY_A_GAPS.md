# Commercial Maturity A — Gap Matrix (live SSOT)

**Rubric:** `COMMERCIAL_MATURITY_RUBRIC.md`  
**Baseline:** `COMMERCIAL_MATURITY_BASELINE_2026-07-15.md` (frozen)  
**Evidence:** `COMMERCIAL_MATURITY_A_EVIDENCE.md`  
**Updated:** 2026-07-15 loop-2

| ID | Dim | Now | Target | Root cause | Fix | Accept evidence (prod) | Autonomous? |
|----|-----|-----|--------|------------|-----|------------------------|-------------|
| G12 | D09 | B | A− | Hobby CLI quota / preview burn | Prefer Actions; optional Pro | CLI deploy succeeds when needed | WATCH |
| G05 | D05 | B− | A− | Catalog anon WRITE still on prod | Founder APPLY maturity migrate | anon PATCH 4xx + service PATCH 2xx | Preflight clear; Founder gate |
| G05b | D05 | B (degraded) | A− | No distributed limiter | Keep memory fallback; enable Upstash | `booking-health.rate_limit_mode=upstash` | Founder sets Upstash |
| G06 | D06 | C+ | A− | No checksummed drill artifact in prod | `db:backup`/`restore-drill` + Environment job | `drill-result.json` pass | Ops via Environment |
| G07 | D07 | B− | A− | Contracts unmet; ops_events missing | Fix migration name; apply; accumulate 7d | `contract_satisfied` on gating metrics | Migration fix in loop-2 |
| G02 | D02 | B | A− | Refund SQL not on prod; money policy TBD | Apply refund migration; Founder policy | refund_requests HTTP 200 + policy doc | Partial |
| G03 | D03 | B | A− | Today ops not on prod SHA | Deploy + phone verify | Mobile task hops + branch isolation | E2E ✅; prod after G12 |
| G09 | D09 | A− (CI) | A− | — | — | GH Actions success on #213 | ✅ CI green |

## Deploy order (mandatory)

1. Merge + deploy app (service-role catalog writes + `/api/payment/status`)  
2. Confirm production SHA  
3. Run `Production maturity migrate` workflow (`confirm=APPLY`) under Environment **`Production`**  
4. Probes must print `PROBES_OK`  

Wrong order (RLS before service-role deploy) is **blocked by preflight**.  
Current blocker: Vercel Hobby `api-deployments-free-per-day` keeps prod on `cfc940b`.

## Founder-only (no agent secret handoff)

| Item | Channel |
|------|---------|
| Vercel Hobby quota / Pro | Billing or wait ~24h |
| GitHub Environment `Production` secrets + reviewers | Dashboard — never paste into Agent chat |
| Upstash | Vercel env |
| Supabase Pro/PITR pay | Billing decision |
| Refund money table | Legal/ops policy |
