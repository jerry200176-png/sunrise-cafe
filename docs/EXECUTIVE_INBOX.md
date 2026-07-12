# Executive Inbox — Operational Signals

**CTO Operating System v2 · Company-first**  
**Review cadence:** Every iteration **before** selecting work  
**Last reviewed:** 2026-07-12 22:55 CST (Round 25 — doc drift sync + migration verification)

> **`cto:orchestrator`** → auto-select next task → execute → verify → record  
> Governance gate **PASS** — feature work may proceed.

---

## 本輪審查（Round 25 · Doc drift sync）

### Governance Gate

| 信號 | 狀態 | 證據 |
|------|------|------|
| `cto:governance` | 🟢 **PASS** | GitHub 97, open PRs ≤ 3 |
| Founder blockers | 🟡 | OUTCOME_LOG baseline, optional `line_group_id` migration |

### Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Health | 🟢 | `/api/booking-health` ok |
| SHA parity | 🟢 | main `278837c` · prod `278837c` (`GET /api/version`) |
| CI main | 🟢 | green |
| Tests | 🟢 | 167 unit + 9 E2E (2 skip) |
| Vercel preview | 🟡 | Hobby rate limit may block PR checks ~24h; prod unaffected |

### Customer Feedback

| 信號 | 狀態 |
|------|------|
| 客訴 / bug 回報 | 🟢 無新回報（Gmail scan #151） |
| 付款糾紛 | 🟡 潛在 — 審核 SLA 未量測 |
| 訂位錯誤 | 🟢 overlap constraint 已套用（DB verified） |

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
| Dependabot | 🟢 closed / rejected per DL-012 |

### GitHub Activity

| 信號 | 數量 |
|------|------:|
| Open PRs | 2 draft (#152, #154) |
| Open Issues | 4 strategic |
| Ghost PRs | 🟢 cleaned 2026-07-11 |

### Operational Risks（持續追蹤至關閉）

| ID | 風險 | 嚴重度 | 狀態 |
|----|------|--------|------|
| R-001 | Migration 未套用 | — | **CLOSED** 2026-07-12 — prod DB verified |
| R-002 | 幽靈 PR | — | **CLOSED** |
| R-004 | KPI 盲飛 | 🟡 | OPEN — Outcome baseline 待 Founder |
| R-005 | Cron 成功率未知 | 🟡 | OPEN — `job_runs` table ready; await cron cycle |

---

## 🔴 Critical

*（無）*

## 🟠 High

| ID | Signal | Owner |
|----|--------|-------|
| INB-005 | KPIs unmeasured | **Ops** — 使用 `OPS_WEEKLY_BUSINESS_REVIEW.md` |
| INB-009 | #53 訂金流程 — **流程優先於 code** | 店長 — `OPS_PAYMENT_SOP.md` |

## 🟡 Medium

| INB-006 | Cron success rate unverified | Eng — check `/admin/executive` after cron |
| INB-010 | `branches.line_group_id` optional migration | Eng — multi-branch LINE without env fallback |
| INB-008 | esbuild/postcss moderate (dev) | Eng (defer) |

## 🟢 Resolved

| ID | Resolution |
|----|------------|
| INB-001 | 3 core DB migrations applied — verified 2026-07-12 |
| INB-003 | Ghost PRs closed |
| INB-R8 | #88 security + Inbox system |
| INB-R9 | Production SHA parity `278837c` |

---

## 本輪 MDU 判定（Round 25）

| 候選 | 類型 | ROI | 選擇 |
|------|------|-----|------|
| **doc-drift sync** | **治理** | **高** — stop false migration alarms | ✅ **執行** |
| OPS-004b funnel aggregation | 產品 | 高 — unlock KPIs | 下一輪 |
| ADM-002e admin page dialogs | UX | 中 — remaining alert/confirm | 下一輪 |
| outcome-unmeasured | 營運 | 高 — Founder baseline | **Founder** |

---

*Next: OPS-004b or ADM-002e → `cto:orchestrator -- complete` → auto-plan iter-026*
