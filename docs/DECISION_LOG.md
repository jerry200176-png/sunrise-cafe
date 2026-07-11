# Decision Log — CTO Operating System v2

**Rule:** Every prioritization change must have a log entry **before** execution.

---

## Round 8 — 2026-07-11

### DL-011: Company-first — Ops Excellence Pack over engineering

**Inbox refs:** INB-001, INB-005, #53  
**Mode shift:** Engineering-first → **Company-first**

**Options evaluated:**

| Option | Business ROI | Time | Verdict |
|--------|-------------|------|---------|
| A. #53 付款流程寫 code | 高（長期） | 高 | 延後 — 無 KPI baseline |
| B. Merge Dependabot #90/#91 | 低 | 中 | ❌ 仍為 Next 16 jump |
| C. **Ops 三件套文件** | **最高** — 解鎖 migration、KPI、訂金 SOP | 低 | ✅ **Selected** |

**Why highest company ROI:**
- R-001 migration：Runbook 降低套用摩擦 → 直接解 CX/營收風險
- R-004 KPI 盲飛：Weekly Review SQL → 本週即可量測訂金率
- #53 營收：Payment SOP → 店員今日可執行，無需 deploy

**MDU:** Ops Migration Runbook + Weekly Business Review + Payment SOP

---

### DL-012: Reject Dependabot #90/#91 (same as DL-008)

New dependabot PRs still target Next 16.2.10. Founder 關閉；controlled minors only.

---

## Round 9 — 2026-07-11

### DL-013: Revert doc-based health inflation — outcomes require production evidence

**Inbox refs:** INB-005, R-004  
**User directive:** Company-first mode — distinguish capability vs business outcomes

**Problem (Round 8 mistake):**
- Revenue health +15 points awarded for **documentation existence** (Weekly Review + Payment SOP)
- CX/Revenue scores did not reflect actual business performance
- No artifact governance (owner, cadence, retirement)

**Decision:**

| Rule | Enforcement |
|------|-------------|
| Capability ≠ Outcome | `HEALTH_SCORES.md` split; script outputs both |
| Outcome scores frozen at baseline until measured | CX=40, REV=35 when `OUTCOME_LOG` unmeasured |
| No doc-existence bonuses | Removed KPI playbook +8, Payment SOP +7 |
| Every ops artifact governed | `OPS_ARTIFACT_REGISTRY.md` ART-001–006 |
| Weekly Outcome Review mandatory | `OPS_WEEKLY_BUSINESS_REVIEW.md` § Outcome Review |
| Stop rule | Artifact >8 weeks with no outcome improvement → retire/redesign |

**MDU:** `OUTCOME_LOG.md` + `OPS_ARTIFACT_REGISTRY.md` + health script rewrite + Outcome Review section

**Expected health impact:** Overall ~81 → **~72** until first measured outcome entry (honest baseline)

---

## Round 10 — 2026-07-11

### DL-014: Outcome Pipeline automation over governance expansion

**User directive:** Stop expanding governance; automate production-backed metrics.

**Decision:**

| Build | Skip |
|-------|------|
| `/api/cto/outcomes` + `/api/admin/outcomes` | More artifact registry entries |
| `/admin/executive` live dashboard | Manual SQL weekly ritual as primary |
| `npm run cto:outcomes` auto-sync | Doc-only health score changes |

**MDU:** `outcome-metrics.ts` + API routes + Executive UI + pipeline script

**Founder action:** Set `CTO_OUTCOME_SECRET` on Vercel (can reuse `CRON_SECRET`)

---

## Round 11 — 2026-07-11

### DL-015: AI Engineering Orchestrator as long-term OS

**User directive:** Design orchestrator comparable to world-class AI eng workflows; use immediately.

**Options evaluated:**

| Option | Impact | Verdict |
|--------|--------|---------|
| A. More governance docs only | Low — no auto task selection | ❌ |
| B. **Orchestrator + task catalog + roles** | **Highest** — autonomous discover/prioritize/execute loop | ✅ **Selected** |
| C. Jump to feature (payment images) | Medium — gate still BLOCK | Defer post-gate |

**Architecture:**
- `npm run cto:orchestrator` → discover → prioritize → plan
- `orchestrator/task-catalog.json` extensible queue
- 8 role playbooks (single agent → multi-agent ready)
- `state.json` + `ORCHESTRATOR_LOG.md` for recovery/audit
- Daily CI heartbeat `.github/workflows/orchestrator.yml`

**MDU:** Orchestrator platform (this PR) + doc drift fix + CAPABILITY_GAPS registry

**Next auto-selected task after merge:** `doc-drift-fix` when deploy LIVE; else STANDBY idle.

---

## Round 11 — 2026-07-11 (continued)

### DL-016: Autonomous loop via GitHub Actions (not Cursor headless)

**User directive:** Unattended engineering loop; prove with canary.

**Environment proof:**
- `cursor` CLI: **not installed**
- `codex exec`: available via npx; needs `OPENAI_API_KEY` in CI
- Cloud agent `gh` token: **cannot** create PRs, close issues, or workflow_dispatch

**Decision:** Implement real loop in **GitHub Actions** + `scripts/orchestrator/loop.sh`. Cursor sessions remain interactive fallback.

**Operational rule:** `operational_mode=LIVE` only when prod SHA = main. Currently **STANDBY** until Founder `vercel deploy --prod`.

**MDU:** PR #106 autonomous loop + canary evidence

---

## Round 7 — 2026-07-11

### DL-007: Executive Inbox review mandatory

**Decision:** All future iterations start with `EXECUTIVE_INBOX.md` review.  
**Rationale:** Prevents executing stale queue items (#87 already merged).  
**Outcome:** Inbox created; 8 active signals catalogued.

---

### DL-008: Reject Dependabot #64/#65 as-is → controlled security MDU

**Inbox refs:** INB-002, INB-004  
**Options considered:**

| Option | Business impact | Risk | Verdict |
|--------|-----------------|------|---------|
| A. Merge #64/#65 | None short-term | **Next 16 breaking** — weeks of regression | ❌ Reject |
| B. Close + ignore deps | Saves time | Critical CVEs remain | ❌ Reject |
| C. **Controlled patch within Next 15** | Security without platform migration | Low — 129 tests + CI | ✅ **Selected** |

**Why highest ROI now:**
- Rank 1 (migrations) blocked on Ops manual access
- Rank 2 (close PRs) blocked on Founder GitHub permissions
- Rank 6 (Dependabot) is **actionable by Eng** and addresses **Security** tier
- npm audit showed **1 critical + 4 high** on `main` before patch

**MDU:** PR #88 — `next@15.5.20`, `@sentry/nextjs@10.65.0`, `npm audit fix`, dependabot ignore majors

---

### DL-009: Defer #53 payment flow to post-security

**Decision:** Payment optimization (#53) remains P1 but **after** dependency CVE patch.  
**Rationale:** Security tier > Revenue when active critical CVEs on framework.

---

### DL-010: Health scores must use `cto-health-scores.sh`

**Decision:** Replace manual estimates in Dashboard §2 with script output.  
**Formula doc:** `docs/HEALTH_SCORES.md`

---

## Round 6 — 2026-07-11

### DL-006: Cron alerting before Dependabot

Merged #87 first — production stability + revenue (reminders) over dependency churn.

---

## Round 5–4 (summary)

| ID | Decision |
|----|----------|
| DL-005 | Wave 3b closed_dates before Cron — CX/revenue on wrong booking dates |
| DL-004 | Wave 3 RBAC — staff could PATCH prices (security) |
| DL-003 | Close ghost PRs delegated to Founder (bot permission) |
| DL-002 | Migrations Rank 1 — Ops manual, don't block Eng |
| DL-001 | Phase 4–8 programs deferred — no business evidence |

---

*Append only. Do not delete entries.*
