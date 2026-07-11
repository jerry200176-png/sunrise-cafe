# Decision Log — CTO Operating System v2

**Rule:** Every prioritization change must have a log entry **before** execution.

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
