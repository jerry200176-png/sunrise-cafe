# Health Scores — Documented Metrics

**CTO OS v2** — Scores are **calculated**, not estimated.  
**Script:** `npm run cto:health`

---

## Capability vs Outcome（Round 9+）

| Score type | Source | Can docs alone raise it? |
|------------|--------|--------------------------|
| **Capability** | Code deployed, infra checklist | No — requires production capability |
| **Outcome** | [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) measured evidence | **Never** from documentation |

**Overall business health** uses **outcome** dimensions where applicable.  
Capability-only dimensions (Security, DX) use technical evidence.

---

## Dimensions & Weights (Overall)

| Dimension | Weight | Type | Formula |
|-----------|-------:|------|---------|
| Production stability | 25% | Capability | §1 |
| Security | 20% | Capability | §2 |
| GitHub governance | 10% | Capability | §3 |
| Product quality | 15% | Capability | §4 |
| Customer experience | 15% | **Outcome** | §5 |
| Revenue reliability | 10% | **Outcome** | §6 |
| Developer experience | 5% | Capability | §7 |

---

## §1 Production Stability (Capability)

| Metric | Points | Condition |
|--------|-------:|-----------|
| Health endpoint | 30 | `/api/booking-health` ok |
| SHA parity | 30 | production SHA = `main` |
| CI pass rate | 25 | last 10 `main` runs success % × 25 |
| Test suite | 15 | min(15, tests ÷ 10) |

---

## §2 Security (Capability)

| Metric | Points | Condition |
|--------|-------:|-----------|
| RBAC enforcement | 50 | reservation + payment routes |
| Admin deny-by-default | 20 | production |
| npm audit | 30 | 30 − critical×15 − high×8 − moderate×2 |

---

## §3 GitHub Governance (Capability)

Base 100 − draft×5 − stale×3 − dependabot_open×10 (floor 0)

---

## §4 Product Quality (Capability)

Points from **deployed code** on `main` (Implementation Truth checklist).  
**Not** from roadmap docs.

---

## §5 Customer Experience — Outcome only

**Requires `OUTCOME_LOG` entry ≤14 days old.**

| Metric | Points | Condition |
|--------|-------:|-----------|
| Baseline (unmeasured) | **40** | frozen until first outcome entry |
| migrations_all_applied = yes | +15 | production evidence |
| overlap_constraint_active = yes | +15 | production evidence |
| deposit_rate ≥85% | +15 | measured |
| deposit_rate 75–84% | +8 | measured |
| Customer complaints (manual) | +15 | zero new in week (logged in outcome) |

**Max 100.** Without outcome entry: **40** (honest "unknown CX").

---

## §6 Revenue Reliability — Outcome only

**Requires `OUTCOME_LOG` entry ≤14 days old.**

| Metric | Points | Condition |
|--------|-------:|-----------|
| Baseline (unmeasured) | **35** | frozen — technical capability exists but outcomes unknown |
| deposit_rate_pct ≥85 | +25 | measured |
| deposit_rate_pct 75–84 | +15 | measured |
| deposit_rate_pct 65–74 | +8 | measured |
| waitlist_conversion ≥30% | +15 | measured |
| payment_review_oldest <4h | +15 | measured |
| payment_review_oldest 4–24h | +8 | measured |

**Removed (Round 9):** ~~KPI playbook documented +8~~, ~~Payment SOP +7~~

Technical enablers (cron, alert) are **capability** — listed in Implementation Truth, **not** revenue outcome points.

---

## §7 Developer Experience (Capability)

| Metric | Points |
|--------|-------:|
| CI green | 30 |
| Test count ≥100 | 25 |
| `cto:snapshot` + `cto:health` scripts work | 20 |
| SSOT docs exist | 10 |

SSOT docs capped at **10** — documentation alone cannot dominate DX.

---

## Thresholds

| Score | Grade |
|------:|-------|
| 90+ | Production-grade outcomes |
| 80–89 | Operable |
| 70–79 | Capability without proven outcomes |
| <70 | Stabilize |
