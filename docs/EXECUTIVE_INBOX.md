# Executive Inbox — Operational Signals

**CTO Operating System v2 · Company-first**  
**Review cadence:** Every iteration **before** selecting work  
**Last reviewed:** 2026-07-11 13:20 UTC (Round 10 — Engineering Governance)

> Inbox → **`cto:governance` gate** → Decision Log → **Company ROI** → MDU  
> **Round 10:** Repository-driven governance — feature work blocked when gate exit 2.

---

## 本輪審查（Round 10 · Engineering Governance）

### Governance Gate

| 信號 | 狀態 | 證據 |
|------|------|------|
| `cto:governance` | 🔴 **BLOCK** (expected) | GitHub hygiene + overall <70 |
| Policy SSOT | 🟢 | `ENGINEERING_GOVERNANCE.md` shipped |
| Weekly CI gate | 🟢 | `.github/workflows/governance.yml` |
| Founder blockers | 🟠 | `FOUNDER_ACTION_LIST.md` — bot cannot close issues/PRs |

### Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Health | 🟢 | `/api/booking-health` ok |
| SHA parity | 🟢 | main `2dbad8e` = production (#101) |
| CI main | 🟢 | 10/10 success |
| Tests | 🟢 | 149 unit + 7 E2E (1 skip) |

### Customer Feedback

| 信號 | 狀態 |
|------|------|
| 客訴 / bug 回報 | 🟢 無新回報 |
| 付款糾紛 | 🟡 潛在 — 審核 SLA 未量測 |
| 訂位錯誤 | 🟡 overlap constraint 待 migration |

### Business KPIs & Financial

| KPI | 目標 | 量測狀態 | 財務影響 |
|-----|------|----------|----------|
| 訂金收取率 | ≥85% | 🔴 **UNMEASURED** | 直接營收 |
| 候補轉換 | ≥30% | 🔴 UNMEASURED | 滿房恢復 |
| 逾期釋放 | 最小化 | 🟡 後台有風險清單 | 每筆 = 流失訂金 |

> **DL-013:** Health outcome 分數凍結在 baseline（CX 40 / REV 35）直到 `OUTCOME_LOG` 有 measured 條目。

### Security

| 信號 | 狀態 |
|------|------|
| npm audit high+ | 🟢 0 (#88) |
| Dependabot #90/#91 | 🟠 Next 16 — 拒絕 (DL-012) |

### GitHub Activity

| 信號 | 數量 |
|------|------:|
| Open PRs | 11（8 draft + #89 docs + #90/#91 dependabot） |
| Open Issues | 7 |
| Ghost PRs #70–77 | 仍開放 — Founder |

### Operational Risks（持續追蹤至關閉）

| ID | 風險 | 嚴重度 | 狀態 |
|----|------|--------|------|
| R-001 | Migration 未套用 | 🔴 | OPEN — ART-001 |
| R-002 | 幽靈 PR | 🟠 | OPEN |
| R-004 | KPI 盲飛 | 🟡 | OPEN — **首週 Outcome Review 待執行** |
| R-005 | Cron 成功率未知 | 🟡 | OPEN |

---

## 🔴 Critical

| ID | Signal | Owner |
|----|--------|-------|
| INB-001 | 3 DB migrations unapplied | **Ops** — 使用 `OPS_MIGRATION_RUNBOOK.md` |

## 🟠 High

| ID | Signal | Owner |
|----|--------|-------|
| INB-003 | 7 ghost PRs + #90/#91 dependabot | Founder |
| INB-005 | KPIs unmeasured | **Ops** — 使用 `OPS_WEEKLY_BUSINESS_REVIEW.md` |
| INB-009 | #53 訂金流程 — **流程優先於 code** | 店長 — `OPS_PAYMENT_SOP.md` |

## 🟡 Medium

| INB-006 | Cron success rate unverified | Eng (later) |
| INB-008 | esbuild/postcss moderate (dev) | Eng (defer) |

## 🟢 Resolved

| ID | Resolution |
|----|------------|
| INB-R8 | #88 security + Inbox system |
| INB-R9 | Production f0be69f deployed |

---

## 本輪 MDU 判定（Round 10 · Engineering Governance）

| 候選 | 類型 | ROI | 選擇 |
|------|------|-----|------|
| **Engineering governance OS** | **治理** | **最高** — durable gate before features | ✅ **執行** |
| Founder GitHub batch | 營運 | 高 — unblocks GitHub score | **Founder 待執行** |
| #53 payment code | Eng | 中（無 baseline） | 延後至 gate PASS |
| LINE image storage | Eng | 高 staff friction | 延後至 gate PASS |

---

*Next: merge governance PR → Founder executes `FOUNDER_ACTION_LIST.md` → re-run `cto:governance` until PASS → resume feature MDUs*
