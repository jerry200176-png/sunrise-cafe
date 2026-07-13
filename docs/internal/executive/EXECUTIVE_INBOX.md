# Executive Inbox — Operational Signals

**CTO Operating System v2 · Company-first**  
**Review cadence:** Every iteration **before** selecting work  
**Last reviewed:** 2026-07-13 15:05 CST (employee dispatch — deploy verify + LINE validation SOP)

> **`cto:orchestrator`** → auto-select next task → execute → verify → record  
> Governance gate **PASS** — feature work may proceed.

---

## 本輪審查（Round 26 · Employee dispatch）

### Governance Gate

| 信號 | 狀態 | 證據 |
|------|------|------|
| `cto:governance` | 🟢 **PASS** | GitHub 0 open PRs · 1 issue (#99) |
| Founder blockers | 🟡 | Production deploy quota · optional `line_group_id` |

### Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Health | 🟢 | `/api/booking-health` ok |
| SHA parity | 🟠 | main `a52f8d4` · prod `f4830c9` — GHA `deploy_rate_limited` |
| Deploy gate | 🟠 **STANDBY** | `scripts/orchestrator/deploy-gate.sh` · no `VERCEL_TOKEN` in agent env |
| CI main | 🟢 | green |
| Tests | 🟢 | **186** unit + **23** E2E (2 skip) |
| LINE Flex (#178) | 🟡 on `main` | Await prod deploy · shop script: `docs/OPS_LINE_CARD_VALIDATION.md` |

### Customer Feedback

| 信號 | 狀態 |
|------|------|
| 客訴 / bug 回報 | 🟢 無新回報 |
| 付款糾紛 | 🟢 0 待審（OUTCOME_LOG 2026-07-12） |
| 訂位錯誤 | 🟢 overlap constraint active |

### Business KPIs & Financial

| KPI | 目標 | 量測狀態 | 財務影響 |
|-----|------|----------|----------|
| 訂金收取率 | ≥85% | 🟡 **82.4%** (2026-07-12) | 略低目標 — 流程優先 `OPS_PAYMENT_SOP` |
| 候補轉換 | ≥30% | 🔴 無候補樣本 | — |
| 逾期釋放 | 最小化 | 🟡 後台風險清單 | 每筆 = 流失訂金 |
| 審核 SLA | <4h | 🟢 0 待審 | — |

### GitHub Activity

| 信號 | 數量 |
|------|------:|
| Open PRs | **0** |
| Open Issues | **1** (#99 strategic) |
| Ghost PRs | 🟢 cleaned |

### Operational Risks（持續追蹤至關閉）

| ID | 風險 | 嚴重度 | 狀態 |
|----|------|--------|------|
| R-004 | KPI 盲飛 | 🟡 | **IMPROVING** — baseline 82.4%; refresh weekly |
| R-005 | Cron 成功率未知 | 🟡 | OPEN — check `/admin/executive` after 20:00 cron |
| R-006 | Prod behind main | 🟠 | OPEN — Vercel Hobby deploy quota |

---

## 本輪審查（Round 25 · Doc drift sync — archived）

## 🔴 Critical

*（無）*

## 🟠 High

| ID | Signal | Owner |
|----|--------|-------|
| INB-005 | 訂金率 82.4% < 85% 目標 | **店長** — `OPS_PAYMENT_SOP.md` + deploy 後跑 `OPS_LINE_CARD_VALIDATION.md` |
| INB-009 | #53 訂金流程 — **流程優先於 code** | 店長 — `OPS_PAYMENT_SOP.md` |

## 🟡 Medium

| INB-006 | Cron success rate unverified | Eng — check `/admin/executive` after cron |
| INB-011 | Prod SHA behind main (#178) | **Founder** — Vercel quota reset or `vercel deploy --prod` |
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

## 本輪 MDU 判定（Round 26）

| 候選 | 類型 | ROI | 選擇 |
|------|------|-----|------|
| **Prod deploy catch-up** | **營運** | **高** — #178 上線 | ⏳ **Blocked** — Vercel quota |
| **LINE shop validation** | **QA** | **高** — deploy 後 15min | ✅ SOP 已寫 `OPS_LINE_CARD_VALIDATION.md` |
| OPS-004b funnel aggregation | 產品 | 高 — 訂金率 82.4→85% | 下一輪 |
| #99 Stripe/LINE Pay | 策略 | 中 | **Defer** — KPI 穩定後 |

---

## 本輪 MDU 判定（Round 25 — archived）

| 候選 | 類型 | ROI | 選擇 |
|------|------|-----|------|
| doc-drift sync | 治理 | 高 | ✅ 執行 (#179) |

---

*Next: prod deploy catch-up → shop LINE validation → OPS-004b (funnel)*
