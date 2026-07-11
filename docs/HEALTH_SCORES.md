# Health Scores — Documented Metrics

**CTO OS v2** — Scores are **calculated**, not estimated.  
**Script:** `npm run cto:health` → paste into `EXECUTIVE_DASHBOARD.md` §2

---

## Dimensions & Weights (Overall)

| Dimension | Weight | Formula reference |
|-----------|-------:|-------------------|
| Production stability | 25% | §1 |
| Security | 20% | §2 |
| GitHub governance | 10% | §3 |
| Product quality | 15% | §4 |
| Customer experience | 15% | §5 |
| Revenue reliability | 10% | §6 |
| Developer experience | 5% | §7 |

**Overall** = Σ (dimension × weight), rounded integer.

---

## §1 Production Stability (0–100)

| Metric | Points | Condition |
|--------|-------:|-----------|
| Health endpoint | 30 | `/api/booking-health` ok |
| SHA parity | 30 | production SHA prefix = `main` SHA |
| CI pass rate | 25 | last 10 `main` runs success % × 25 |
| Test suite | 15 | min(15, tests ÷ 10) — cap at 150 tests |

---

## §2 Security (0–100)

| Metric | Points | Condition |
|--------|-------:|-----------|
| RBAC reservation routes | 25 | enforced in code |
| RBAC payment routes | 25 | enforced in code |
| Admin deny-by-default | 20 | production requires auth |
| npm audit | 30 | 30 − critical×15 − high×8 − moderate×2 (floor 0) |

---

## §3 GitHub Governance (0–100)

| Metric | Points | Condition |
|--------|-------:|-----------|
| Base | 100 | |
| Draft PR penalty | −5 each | open draft PRs |
| Stale PR penalty | −3 each | non-dependabot open PRs >7d |
| Dependabot failing | −10 | if any dependabot PR CI red |

---

## §4 Product Quality (0–100)

Checklist from Implementation Truth (each ✅ = points):

| Capability | Points |
|------------|-------:|
| Guest auth | 15 |
| Double-book handling | 15 |
| Server-side pricing | 15 |
| Payment review flow | 15 |
| Waitlist | 10 |
| Per-branch closed_dates | 15 |
| Cron alerting | 15 |

---

## §5 Customer Experience (0–100)

| Metric | Points |
|--------|-------:|
| Booking wizard functional | 25 |
| LINE deposit flow | 25 |
| Per-branch availability | 25 |
| Admin RBAC (safe staffing) | 25 |

Deductions: migration not applied for closed_dates (−10), overlap constraint (−10).

---

## §6 Revenue Reliability (0–100)

| Metric | Points | Condition |
|--------|-------:|-----------|
| Deposit deadline cron | 25 | code exists |
| Cron failure alert | 25 | #87 merged |
| Waitlist notify | 20 | on cancel |
| Payment keywords | 15 | configurable |
| KPI playbook documented | 8 | `OPS_WEEKLY_BUSINESS_REVIEW.md` exists |
| Payment SOP documented | 7 | `OPS_PAYMENT_SOP.md` exists |
| KPI automated in admin | 15 | deposit rate dashboard (else 0) |

---

## §7 Developer Experience (0–100)

| Metric | Points |
|--------|-------:|
| CI green | 30 |
| SSOT docs (Inbox + Dashboard + Truth) | 25 |
| Snapshot script | 20 |
| Test count ≥100 | 25 |

---

## Thresholds

| Score | Grade |
|------:|-------|
| 90+ | Production-grade |
| 80–89 | Operable, gaps documented |
| 70–79 | Risky for multi-store |
| <70 | Stabilize before features |
