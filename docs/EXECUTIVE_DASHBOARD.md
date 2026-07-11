# Executive Dashboard — Sunrise Systems

**CTO OS v2 · Company-first · SSOT**  
**最後更新：** 2026-07-11 Round 10 — Outcome Pipeline  
**Production：** https://sunrise-cafe-six.vercel.app · `/admin/executive`

> **每輪：** Inbox → Decision Log → **live metrics** at `/admin/executive`  
> `npm run cto:outcomes` · `npm run cto:health` · `npm run cto:snapshot`

---

## 0. Executive Inbox 摘要（Round 10）

**模式：** Automation-first — live production metrics, not manual docs

| 維度 | 信號 | 判定 |
|------|------|------|
| Production | 🟢 health · CI | 穩定 |
| Business KPI | 🟢 **automated** | `/admin/executive` + `/api/cto/outcomes` |
| Ops risk | 🔴 migration | ART-001 待執行 |
| GitHub | 🟠 11 open PR | Founder |

**決策 DL-014：** Outcome Pipeline > more governance docs

---

## 1. Executive Summary

| 指標 | 狀態 |
|------|------|
| **公司能否營運？** | 🟢 平台穩定 |
| **能否看見營收健康度？** | 🟢 **Outcome Pipeline** — `/admin/executive` |
| **店員能否正確收訂金？** | 🟡 SOP 就緒（ART-003），執行待驗證 |
| **DB 與程式同步？** | 🔴 ART-001 待 Ops 執行 |
| **本輪 MDU** | Outcome Pipeline — automated production metrics |

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

## 3. 營運 KPI（自動化 — 取代手動 SQL）

| KPI | 目標 | 來源 |
|-----|------|------|
| 訂金收取率 | ≥85% | `/api/admin/outcomes` → `payment.deposit_rate_pct` |
| 審核 SLA | <4hr | `payment.payment_review_oldest_hours` |
| 候補轉換 | ≥30% | `waitlist.conversion_pct` |
| 系統可用性 | 99.5% | `deployment.health_ok` |

**UI:** https://sunrise-cafe-six.vercel.app/admin/executive

---

## 4. Business Impact Queue（Company-first 重排）

| Rank | 工作 | 類型 | 狀態 |
|------|------|------|------|
| 1 | **使用 Executive Dashboard 決策** | **營運** | ✅ `/admin/executive` live |
| 2 | Ops 套用 migration | **營運** | ART-001 |
| 3 | 設定 `CTO_OUTCOME_SECRET` on Vercel | Eng/Ops | 啟用 `cto:outcomes` cron sync |
| 4 | Founder 關閉幽靈 PR | 治理 | 手動 |
| 5 | #53 付款工程 | Eng | 待 outcome 顯示 <75% 連續 2 週 |

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
/admin/executive                    ← live Outcome Pipeline UI
/api/admin/outcomes                 ← authenticated metrics API
/api/cto/outcomes                   ← machine sync (CTO_OUTCOME_SECRET)
docs/OUTCOME_LOG.md                 ← auto-sync target for cto:health
```

---

## 7. 快照

```
日期：2026-07-11 Round 10
MDU：Outcome Pipeline (API + /admin/executive)
下一輪：Set CTO_OUTCOME_SECRET → npm run cto:outcomes → migrations
```

---

*Optimize the company, not the repository.*
