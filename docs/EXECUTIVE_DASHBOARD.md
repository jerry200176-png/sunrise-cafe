# Executive Dashboard — Sunrise Systems

**CTO OS v2 · Company-first · SSOT**  
**最後更新：** 2026-07-11 Round 8  
**Production：** https://sunrise-cafe-six.vercel.app · `f0be69f`

> **每輪：** [`EXECUTIVE_INBOX.md`](./EXECUTIVE_INBOX.md) → [`DECISION_LOG.md`](./DECISION_LOG.md) → 本文件  
> `npm run cto:health` · `npm run cto:snapshot`

---

## 0. Executive Inbox 摘要（Round 8）

**模式：** Company-first — 優化公司，不是 repository

| 維度 | 信號 | 判定 |
|------|------|------|
| Production | 🟢 health · SHA · CI | 穩定 |
| Customer | 🟢 無新客訴 | 監控 Payment SOP |
| Business KPI | 🔴 未量測 | **本輪 MDU 解決** |
| Financial | 🟡 逾期釋放風險 | Weekly Review SQL |
| Security | 🟢 audit clean | #90/#91 拒絕 |
| GitHub | 🟠 11 open PR | Founder |
| Ops risk | 🔴 migration | Runbook 已交付 |

**決策 DL-011：** Ops Excellence Pack > #53 寫 code

---

## 1. Executive Summary

| 指標 | 狀態 |
|------|------|
| **公司能否營運？** | 🟢 平台穩定 |
| **能否看見營收健康度？** | 🟡 **本輪建立 Weekly Review** |
| **店員能否正確收訂金？** | 🟡 **本輪建立 Payment SOP** |
| **DB 與程式同步？** | 🔴 Runbook 已備，待 Ops 執行 |
| **本輪 MDU** | 營運三件套（零 deploy） |

---

## 2. 健康度（`npm run cto:health`）

| 維度 | 分數 | 證據 |
|------|------:|------|
| Production stability | 97 | 見腳本輸出 |
| Security | 100 | crit=0 high=0 |
| GitHub governance | 47 | 11 PR / 8 draft |
| Product quality | 85 | checklist |
| Customer experience | 55 | migration pending |
| Revenue reliability | **70→** | +playbook 後重算 |
| Developer experience | 100 | |
| **Overall** | **~81** | weighted |

---

## 3. 營運 KPI（量測方式已建立）

| KPI | 目標 | 量測 |
|-----|------|------|
| 訂金收取率 | ≥85% | [`OPS_WEEKLY_BUSINESS_REVIEW.md`](./OPS_WEEKLY_BUSINESS_REVIEW.md) SQL 1 |
| 審核 SLA | <4hr | SQL 2 + `/admin/payments` |
| 候補轉換 | ≥30% | SQL 4 |
| 系統可用性 | 99.5% | health endpoint 🟢 |

---

## 4. Business Impact Queue（Company-first 重排）

| Rank | 工作 | 類型 | 狀態 |
|------|------|------|------|
| 1 | Ops 套用 migration（Runbook） | **營運** | 📋 文件就緒 |
| 2 | 首週 Business Review | **營運** | 📋 文件就緒 |
| 3 | 店員執行 Payment SOP | **營運** | 📋 文件就緒 |
| 4 | Founder 關閉幽靈 PR + #90/#91 | 治理 | 手動 |
| 5 | #53 付款 **工程**優化 | Eng | 待 KPI baseline |
| 6 | Cron 成功率量測 | Eng | P2 |

---

## 5. 風險登錄簿

| ID | 風險 | 狀態 | 緩解 |
|----|------|------|------|
| R-001 | Migration | OPEN | `OPS_MIGRATION_RUNBOOK.md` |
| R-002 | 幽靈 PR | OPEN | Founder |
| R-004 | KPI 盲飛 | **MITIGATING** | `OPS_WEEKLY_BUSINESS_REVIEW.md` |
| R-006 | 訂金流程不一致 | **MITIGATING** | `OPS_PAYMENT_SOP.md` |

---

## 6. 營運文件（Company SSOT）

```
docs/OPS_MIGRATION_RUNBOOK.md      ← Ops Rank 1
docs/OPS_WEEKLY_BUSINESS_REVIEW.md ← 每週 KPI
docs/OPS_PAYMENT_SOP.md            ← 店員訂金 SOP (#53)
docs/EXECUTIVE_INBOX.md
docs/DECISION_LOG.md
```

---

## 7. 快照

```
日期：2026-07-11 Round 8
SHA：f0be69f
模式：Company-first
MDU：Ops 三件套（無 deploy）
下一輪：Ops 執行 Runbook → 量測首週 KPI → 再排 #53 工程
```

---

*Optimize the company, not the repository.*
