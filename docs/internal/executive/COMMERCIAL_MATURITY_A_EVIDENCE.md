# Commercial Maturity A — Evidence Board

**Rubric (frozen):** `COMMERCIAL_MATURITY_RUBRIC.md`  
**Baseline (frozen):** `COMMERCIAL_MATURITY_BASELINE_2026-07-15.md`  
**Gaps (live):** `COMMERCIAL_MATURITY_A_GAPS.md`  
**Rule:** Append scorecard rows; never overwrite baseline grades.  
**SSOT sync:** 2026-07-15 loop-2 start — #213 merged; production deploy blocked by Vercel Hobby quota.

---

## Loop 2 — post-merge (branch `cursor/maturity-loop2-a33b`)

### Production facts [FACT]

| Check | Result |
|-------|--------|
| PR #213 | **MERGED** `f7d81f2` into `main` (2026-07-15) |
| GH Actions CI on #213 | Lint & Build ✅ · Playwright smoke ✅ |
| `GET /api/version` | Still `cfc940b…` — **not** `f7d81f2` |
| Vercel deploy | `api-deployments-free-per-day` / Hobby rate-limit [FACT] |
| `/api/payment/status` | **404** until deploy lands |
| Catalog RLS / refund migrate | **Blocked by preflight** until Maturity A app live (correct) |
| `ops_events` table | Missing; prior apply failed on `schema_migrations.name` NOT NULL — **fixed in this loop** |
| Migrate Environment name | Corrected to existing **`Production`** (was lowercase `production`) |
| Grade | **B− / B — not A** (no production evidence yet for P0 close) |

### Founder Decision Queue (updated)

| ID | Decision | Default | Notes |
|----|----------|---------|-------|
| FD-Vercel | Wait ~24h quota reset **or** upgrade Vercel plan | Wait unless ops-critical | Blocks prod SHA / migrate / today phone verify |
| FD-ENV | Ensure Environment **`Production`** has DB + anon + service secrets + required reviewers | Yes | Use existing Environment; do not paste secrets to Agent |
| FD-2 | Upstash | Enable | A-grade rate-limit only after `rate_limit_mode=upstash` |
| FD-1 | Supabase Pro/PITR | Optional paid | Scripts cover free-path DR artifacts |

### Next actions (ordered)

1. Wait for Vercel quota **or** Founder upgrades → redeploy main `f7d81f2`(+loop2)  
2. Confirm `/api/version` == main; `/api/payment/status` 200  
3. Run **Production maturity migrate** (`confirm=APPLY`) on Environment `Production`  
4. Expect `PROBES_OK`; phone-verify `/admin/today`  
5. Re-apply `ops_events` via deploy-migrate (name column fixed)  
6. Append scorecard only with production probe evidence  

---

## Loop 1b — converge (merged as #213)

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
| Prod SHA = main | ❌ blocked — Vercel Hobby deploy quota [FACT] |
| No half-finished UX | ✅ |

### Evidence links

| Kind | Ref |
|------|-----|
| PR | https://github.com/jerry200176-png/sunrise-cafe/pull/213 |
| CI | Actions run on branch — Lint & Build + Playwright smoke **success** |
| Workflow | `.github/workflows/production-maturity-migrate.yml` (Environment `Production`, confirm=APPLY) |
| Migrations | `migration-rls-catalog-read-only.sql`, `migration-refund-requests.sql` |
| KPI contracts | `src/lib/north-star-contracts.ts` → `/api/admin/north-star` |

### Founder Decision Queue (no Agent secret paste)

| ID | Decision | Default | Cost | Risk | Latest by | Agent prepared |
|----|----------|---------|------|------|-----------|----------------|
| FD-ENV | Configure GitHub Environment **`Production`** secrets (`SUPABASE_*`, anon, DB URL) + required reviewers | Yes | Ops time | Cannot close P0 | Before migrate | Workflow+preflight+probes (no secrets in logs) |
| FD-Vercel | Hobby deploy quota / Pro | Wait 24h or upgrade | $ | Blocks SHA + RLS | ASAP | deploy.sh already soft-fails on quota |
| FD-2 | Upstash on Vercel | Enable | Low $/mo | Multi-instance blind spots | 7d | Memory degraded fallback |
| FD-1 | Supabase Pro/PITR | If budget; else keep scripted drills | $ | Hosted DR lag | 14d | Artifact/checksum/retention scripts |
| FD-4 | Refund money table | Tiered staff review | Policy | Legal | 14d | Request FSM ready |
| FD-5 | Stripe go-live | Keep closed | Fees | Trust | After KPI | UI/API closed |

**Do not** send production DB URL / service role to the Agent chat. Use Environment secrets only.

---

## Next actions (historical Loop-1b — completed merge; prod lag)

See **Loop 2** section above.
