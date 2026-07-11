# Executive Inbox — Operational Signals

**CTO Operating System v2**  
**Review cadence:** Every iteration **before** selecting work  
**Last reviewed:** 2026-07-11 09:45 UTC (Round 7)

> Inbox → Decision Log → Business Impact Queue → MDU execution

---

## 🔴 Critical (act same day)

| ID | Signal | Source | Since | Owner |
|----|--------|--------|-------|-------|
| INB-001 | **3 DB migrations unapplied** — overlap constraint, RBAC tables, branch closed_dates | Implementation Truth | Round 3 | Ops |
| INB-002 | **Dependabot #64/#65 propose Next 16 jump** — CI fails (`next lint` path error) | GitHub PR checks | 2026-07-09 | Eng |

## 🟠 High (this week)

| ID | Signal | Source | Since | Owner |
|----|--------|--------|-------|-------|
| INB-003 | **7 ghost PRs open** (#70–#76 draft, #77 duplicate) — governance noise | GitHub PR list | Round 4 | Founder |
| INB-004 | **Next.js was on 15.1.9** with critical CVEs (fixed in MDU #88) | npm audit | 2026-07-11 | Eng |
| INB-005 | **Business KPIs unmeasured** — booking completion, deposit rate not in dashboard | KPI §3 | Ongoing | Product |

## 🟡 Medium (scheduled)

| ID | Signal | Source | Since | Owner |
|----|--------|--------|-------|-------|
| INB-006 | **Cron health unverified** — alerting added (#87) but no success metric yet | Production | Round 6 | SRE |
| INB-007 | **7 enhancement issues** backlog — #53 payment flow highest ROI | GitHub Issues | 2026-07-09 | Product+Eng |
| INB-008 | **esbuild/postcss moderate** — dev/transitive only | npm audit | 2026-07-11 | Eng |

## 🟢 Clear / Resolved this round

| ID | Signal | Resolution |
|----|--------|------------|
| INB-R1 | Production SHA lag | ✅ `60bae19` deployed, health ok |
| INB-R2 | Cron silent failure | ✅ #87 LINE alerting merged |
| INB-R3 | staff reservation PATCH | ✅ #85 RBAC merged |
| INB-R4 | Global closed_dates | ✅ #86 per-branch merged |
| INB-R5 | Dashboard manual scores | ✅ `cto-health-scores.sh` Round 7 |

---

## Signal Summary (Round 7 intake)

| Channel | Status | Count |
|---------|--------|------:|
| Production deploy | 🟢 | SHA match |
| `/api/booking-health` | 🟢 | ok |
| CI `main` (last 10) | 🟢 | 100% success |
| Unit tests | 🟢 | 129 pass |
| Open PRs | 🟠 | 10 (7 draft) |
| Open Issues | 🟡 | 7 |
| npm audit (high+) | 🟢 | 0 after #88 |
| Customer bugs | 🟢 | none reported |
| Security alerts | 🟠 | Dependabot major jump blocked |

---

## Customer / Business KPI Inbox

| KPI | Target | Last measured | Signal |
|-----|--------|---------------|--------|
| Booking completion rate | ≥70% | Not automated | 📊 Manual `/admin/insights` |
| Deposit collection rate | ≥85% | Not automated | 📊 Manual |
| Waitlist conversion | ≥30% | Not automated | 📊 Manual |
| Cron success rate | ≥99% | Unknown | 🟡 Needs `job_runs` or log scrape |

---

*Next review: after MDU #88 merge or daily `npm run cto:snapshot`.*
