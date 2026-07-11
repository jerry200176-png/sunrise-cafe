# Executive Dashboard — Sunrise Systems

**CTO OS v2 · Company-first · SSOT**  
**最後更新：** 2026-07-11 Round 9  
**Production：** https://sunrise-cafe-six.vercel.app · `0da948f`

> **每輪：** [`EXECUTIVE_INBOX.md`](./EXECUTIVE_INBOX.md) → [`DECISION_LOG.md`](./DECISION_LOG.md) → 本文件  
> `npm run cto:health` · `npm run cto:snapshot`  
> **Outcome 分數：** 僅 [`OUTCOME_LOG.md`](./OUTCOME_LOG.md) measured 證據

---

## 0. Executive Inbox 摘要（Round 9）

**模式：** Company-first — capability ≠ outcome

| 維度 | 信號 | 判定 |
|------|------|------|
| Production | 🟢 health · CI | 穩定 |
| Customer | 🟢 無新客訴 | 監控 Payment SOP |
| Business KPI | 🔴 UNMEASURED | Outcome 分數凍結 baseline |
| Financial | 🟡 逾期釋放風險 | 待首週 Outcome Review |
| Security | 🟢 audit clean | #90/#91 拒絕 |
| GitHub | 🟠 11 open PR | Founder |
| Ops risk | 🔴 migration | ART-001 待執行 |

**決策 DL-013：** 撤銷 doc-based health inflation；outcome 僅來自 `OUTCOME_LOG`

---

## 1. Executive Summary

| 指標 | 狀態 |
|------|------|
| **公司能否營運？** | 🟢 平台穩定 |
| **能否看見營收健康度？** | 🔴 **尚未量測** — capability 就緒，outcome 待證據 |
| **店員能否正確收訂金？** | 🟡 SOP 就緒（ART-003），執行待驗證 |
| **DB 與程式同步？** | 🔴 ART-001 待 Ops 執行 |
| **本輪 MDU** | Outcome governance（誠實 health 計分） |

---

## 2. 健康度（`npm run cto:health`）

### Capability（技術／生產證據）

| 維度 | 分數 | 證據 |
|------|------:|------|
| Production stability | 85 | health ok；SHA 待驗證 |
| Security | 100 | crit=0 high=0 |
| GitHub governance | 47 | 11 PR / 8 draft |
| Product quality | 85 | checklist |
| Developer experience | 85 | scripts + tests |

### Outcome（`OUTCOME_LOG` 證據 only — status: unmeasured）

| 維度 | 分數 | 證據 |
|------|------:|------|
| Customer experience | **40** | baseline — no measured entry |
| Revenue reliability | **35** | baseline — no measured entry |
| **Overall (weighted)** | **72** | honest until first Outcome Review |

> Round 8 錯誤：文件存在曾給 REV +15 → **已撤銷（DL-013）**

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
| 1 | **首週 Outcome Review** | **營運** | 📋 ART-002 待 Founder 執行 |
| 2 | Ops 套用 migration | **營運** | 📋 ART-001 |
| 3 | 店員執行 Payment SOP | **營運** | 📋 ART-003 |
| 4 | Founder 關閉幽靈 PR + #90/#91 | 治理 | 手動 |
| 5 | #53 付款 **工程**優化 | Eng | 待 KPI baseline + SOP 2 週 |
| 6 | Cron 成功率量測 | Eng | P2 |

---

## 5. 風險登錄簿

| ID | 風險 | 狀態 | 緩解 |
|----|------|------|------|
| R-001 | Migration | OPEN | `OPS_MIGRATION_RUNBOOK.md` |
| R-002 | 幽靈 PR | OPEN | Founder |
| R-004 | KPI 盲飛 | OPEN | 首週 Outcome Review → `OUTCOME_LOG` |
| R-006 | 訂金流程不一致 | MITIGATING | ART-003 執行 + outcome 驗證 |
| R-007 | Health score 誠實度 | **CLOSED** | DL-013 outcome governance |

---

## 6. 營運文件（Company SSOT）

```
docs/OPS_ARTIFACT_REGISTRY.md    ← 每份 artifact 治理
docs/OUTCOME_LOG.md              ← 業務 outcome 證據（驅動 health）
docs/OPS_MIGRATION_RUNBOOK.md    ← ART-001
docs/OPS_WEEKLY_BUSINESS_REVIEW.md ← ART-002 + Outcome Review
docs/OPS_PAYMENT_SOP.md            ← ART-003
docs/EXECUTIVE_INBOX.md
docs/DECISION_LOG.md
```

---

## 7. 快照

```
日期：2026-07-11 Round 9
SHA：0da948f
模式：Company-first · Outcome governance
MDU：OUTCOME_LOG + ARTIFACT_REGISTRY + health script（無 deploy）
下一輪：Founder 首週 Outcome Review → 更新 OUTCOME_LOG → outcome 分數才會變動
```

---

*Optimize the company, not the repository.*
