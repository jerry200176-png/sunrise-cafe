# Commercial Maturity A — Evidence Board

**Rubric (frozen):** `COMMERCIAL_MATURITY_RUBRIC.md`  
**Baseline (frozen):** `COMMERCIAL_MATURITY_BASELINE_2026-07-15.md`  
**Gaps (live):** `COMMERCIAL_MATURITY_A_GAPS.md`  
**Rule:** Append scorecard rows; never overwrite baseline grades.  
**SSOT sync:** 2026-07-15 loop-1b — CI green recorded; rate-limit labeled **degraded**; no agent secret handoff.

---

## Loop 1b — converge (branch `cursor/commercial-maturity-a-a33b`)

### Scorecard (dimensions)

| ID | Baseline | After 1b | Shipped | Prod evidence | Metric / test evidence | Residual |
|----|----------|----------|---------|---------------|-------------------------|----------|
| D01 | B+ | B+ | Half-hour E2E mocks | Prod SHA pre-merge=`cfc940b` | Playwright booking+qa **CI success** | Re-verify SHA after merge |
| D02 | B− | B | Stripe closed; refund API+SQL | create-intent 503 [FACT]; refund table pending migrate | Unit policy tests | Apply refund SQL via Environment workflow |
| D03 | B− | B | Today ops + branch ACL + partial errors + hop metrics + e2e | Not live until merge | `admin-today` unit + Playwright 6/6 (auth cookie, mobile, empty/partial/retry, isolation UX) | Phone verify on prod |
| D05 | B− | **B− prod / B code** | Service-role writes; RLS migration; memory **degraded** enforce; deniedContext | RLS **not** on prod until workflow | Static RLS tests; memory limiter tests | **Upstash required for A− on rate-limit**; RLS apply via controlled workflow |
| D06 | C | C+ | Backup artifact+sha256+manifest+isolated drill | Drill needs Environment DB URL | Scripts refuse placeholders | Pro/PITR Founder-paid optional |
| D07 | C+ | B− | Metric **contracts** on north-star API | Observed mostly incomplete | Contract unit tests | 7d accumulation; continue other work |
| D09 | B+ | **A− (CI)** | — | — | GH Actions Lint+Playwright **success** on #213 | Vercel Hobby preview unrelated |
| D10 | C+ | B− | refund_requests migration | Pending Environment apply | API fail-closed if missing | Apply workflow |

### Whole-product grade

**B− / B — not A.** Untreated P0 until production RLS probes pass; rate-limit only degraded; DR drill not run against real Environment.

### A Gate checklist

| Gate | Status |
|------|--------|
| No untreated P0 | ❌ until prod RLS `PROBES_OK` |
| RLS negative + admin positive | ✅ scripts; ❌ prod until workflow |
| Rate limit | 🟡 **degraded memory** (not A evidence); ❌ Upstash |
| Backup+checksum+isolated drill | 🟡 scripts; ❌ Environment run |
| Booking E2E | ✅ CI |
| Deposit capture clear | ✅ Stripe closed |
| Cancel/refund | 🟡 request path; money policy Founder |
| Today ops acceptance | ✅ automated (not route-build-only); ❌ prod phone |
| North Star contracts | 🟡 definitions live; ❌ satisfied counts |
| Prod SHA = main | ⏳ after merge |
| No half-finished UX | ✅ |

### Evidence links

| Kind | Ref |
|------|-----|
| PR | https://github.com/jerry200176-png/sunrise-cafe/pull/213 |
| CI | Actions run on branch — Lint & Build + Playwright smoke **success** |
| Workflow | `.github/workflows/production-maturity-migrate.yml` (Environment `production`, confirm=APPLY) |
| Migrations | `migration-rls-catalog-read-only.sql`, `migration-refund-requests.sql` |
| KPI contracts | `src/lib/north-star-contracts.ts` → `/api/admin/north-star` |

### Founder Decision Queue (no Agent secret paste)

| ID | Decision | Default | Cost | Risk | Latest by | Agent prepared |
|----|----------|---------|------|------|-----------|----------------|
| FD-ENV | Configure GitHub Environment `production` secrets (`SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, DB URL) + required reviewers | Yes | Ops time | Cannot close P0 | Before migrate | Workflow+preflight+probes (no secrets in logs) |
| FD-2 | Upstash on Vercel | Enable | Low $/mo | Multi-instance blind spots | 7d | Memory degraded fallback |
| FD-1 | Supabase Pro/PITR | If budget; else keep scripted drills | $ | Hosted DR lag | 14d | Artifact/checksum/retention scripts |
| FD-4 | Refund money table | Tiered staff review | Policy | Legal | 14d | Request FSM ready |
| FD-5 | Stripe go-live | Keep closed | Fees | Trust | After KPI | UI/API closed |

**Do not** send production DB URL / service role to the Agent chat. Use Environment secrets only.

---

## Next actions (ordered)

1. Mark PR ready → review → merge  
2. Confirm `/api/version` commit == main  
3. Run **Production maturity migrate** (`confirm=APPLY`)  
4. Expect `PROBES_OK`  
5. Phone-verify `/admin/today`  
6. Append Loop-2 scorecard with production evidence  
7. Continue highest ROI while KPI accumulates 7d
