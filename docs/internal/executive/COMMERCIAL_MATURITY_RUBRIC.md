# Commercial Maturity Rubric (SSOT — Frozen)

**Effective:** 2026-07-15  
**Baseline source:** `COMPETITIVE_AUDIT_2026-07-15.md` + production re-verify same day  
**Rule:** Do **not** redefine grade letters, delete dimensions, or overwrite `BASELINE` rows to inflate scores. Append only.

## Grade definitions (fixed)

| Grade | Meaning |
|-------|---------|
| **C** | Feature exists but flows are broken, rely on manual workarounds, or lack reliable verification. |
| **B** | Core flow usable and relatively reliable; important gaps, manual load, or outcomes unmeasured remain. |
| **A−** | Near A: closed loop for that dimension with production evidence, one bounded residual risk documented. |
| **A** | Core loop closed, production-verified, monitored with failure recovery; users complete tasks stably without high-risk manual patches. |
| **A+** | A plus continuous measurement, iteration, and scalable multi-site replay with clear vertical advantage. |

Partial grades: use A− / B+ / B− when evidence supports; **never** invent + beyond A+ or invent new letters.

## Whole-product A gate (non-negotiable)

All must hold with evidence:

1. No untreated **P0**
2. Security + data correctness + backup/DR ≥ **A−**
3. Guest booking path, deposit ops, staff today-ops, KPI observability ≥ **A−**
4. Every other listed dimension ≥ **B+**
5. No arithmetic-average A while any gating dimension is below threshold
6. Every A / A− claim cites test, production verify, or metric window

### Dimension-specific A requirements (addendum — clarifying, not lowering bar)

| Dimension | Extra A evidence |
|-----------|------------------|
| D05 Rate limiting | **Distributed** limiter enforced in production (`rate_limit_mode=upstash` or equivalent shared store). In-memory per-isolate fallback is **degraded only** — may support B grades, **never** alone prove A−/A for the rate-limit P0. |
| D07 KPI | Each gating metric must satisfy its **contract** (numerator, denominator, timezone, window, freshness, completeness) and truth reconciliation — not merely `observed != null`. |
| D06 DR | Backup artifact + checksum + retention + isolated restore drill result. Pro/PITR is Founder-paid; free-path drill still required. |

## Dimensions (fixed set)

| ID | Dimension |
|----|-----------|
| D01 | 客人訂位主路徑 |
| D02 | 訂金、付款、取消與退費閉環 |
| D03 | 店長後台與今日場控 |
| D04 | 多店與設定管理 |
| D05 | 安全邊界與權限 |
| D06 | 備份、災難復原與營運持續性 |
| D07 | 可觀測性與 North Star KPI |
| D08 | 無障礙、行動版、效能與錯誤恢復 |
| D09 | 工程交付品質 |
| D10 | 稽核、客服與爭議處理能力 |

## A− / A evidence bar (per dimension)

- **Implement** in `main` (or merged PR)
- **Deploy** to production (SHA match)
- **Verify** with automated and/or production probe
- **Measure** where applicable (real Observed ≠ null/pipeline/unknown)
- **Re-grade** only by appending a dated scorecard row

## Related

- Baseline freeze: `COMMERCIAL_MATURITY_BASELINE_2026-07-15.md`
- Live evidence board: `COMMERCIAL_MATURITY_A_EVIDENCE.md` (append-only after each loop)
- Gap work tracking: `COMMERCIAL_MATURITY_A_GAPS.md`
