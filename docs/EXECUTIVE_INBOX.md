# Executive Inbox — Operational Signals

**CTO Operating System v2 · Company-first**  
**Review cadence:** Every iteration **before** selecting work  
**Last reviewed:** 2026-07-11 10:10 UTC (Round 9)

> Inbox → Decision Log → **Company ROI** → MDU（可能是營運，不一定是 code）  
> **Round 9:** Outcome scores require `OUTCOME_LOG` evidence — docs alone do not raise business health.

---

## 本輪審查（Round 9 · Outcome governance）

### Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Health | 🟢 | `/api/booking-health` ok |
| SHA parity | 🟡 | local `0da948f` — verify prod |
| CI main | 🟢 | 10/10 success |
| Tests | 🟢 | 129 pass |

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

## 本輪 MDU 判定（Round 9 · Outcome governance）

| 候選 | 類型 | ROI | 選擇 |
|------|------|-----|------|
| #53 寫 code | Eng | 中（無 baseline） | 延後 |
| #90/#91 merge | Eng | 負（Next 16） | 拒絕 |
| **Outcome governance** | **治理** | **最高** — 修正 health 誠實度 | ✅ **執行** |
| 首週 Outcome Review | **營運** | 高 — 解鎖 outcome 分數 | **Founder 待執行** |

---

*Next: Founder 執行首週 Outcome Review → `OUTCOME_LOG` → 再評估 #53 工程項*
