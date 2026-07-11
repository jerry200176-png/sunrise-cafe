# Executive Dashboard — Sunrise Systems

**CTO Operating System v2 · 單一真實來源（SSOT）**  
**最後更新：** 2026-07-11 Round 6（Wave 4 執行中）  
**Production：** https://sunrise-cafe-six.vercel.app · `v2.2.0` · `4c63223`

> 技術事實以 `IMPLEMENTATION_TRUTH.md` 為準；策略以 `CTO_STRATEGY.md` 為準。

---

## 1. Executive Summary（30 秒）

| 指標 | 狀態 |
|------|------|
| **平台能否營運？** | 🟢 是 — production 健康、CI 綠燈、129 tests |
| **能否安全聘請員工？** | 🟢 是 — 付款 + 訂位 RBAC（#85） |
| **能否多分店？** | 🟢 是 — 公休日 per-branch（#86）；migration 待套用 |
| **最大業務風險** | DB migration 未套用、7 個幽靈 PR（Founder 手動） |
| **本輪最高 ROI** | Cron 告警 #87 → Dependabot #64/#65 |

---

## 2. 健康度計分卡

| 維度 | 分數 | 目標 | 趨勢 | 負責 |
|------|------:|-----:|------|------|
| **工程健康** | 86 | 95 | ↑ | CTO / Eng |
| **資安** | 92 | 95 | ↑ | Security |
| **產品** | 78 | 85 | ↑ | Product |
| **營收可靠性** | 75 | 90 | → | Ops |
| **客戶體驗** | 80 | 85 | ↑ | Product |
| **部署／營運** | 86 | 95 | → | SRE |
| **GitHub 治理** | 58 | 90 | → | Founder |
| **整體** | **84** | 90 | ↑ | CEO |

---

## 3. 營運 KPI（業務面）

| KPI | 定義 | 目標 | 現況 |
|-----|------|------|------|
| **訂位完成率** | `booking_completed ÷ booking_started` | ≥ 70% | 📊 每週查 insights |
| **訂金收取率** | 期限內 `is_deposit_paid=true` | ≥ 85% | 📊 後台 |
| **候補轉換率** | `waitlist.booked ÷ joined` | ≥ 30% | 📊 後台 |
| **Cron 成功率** | 提醒 job 完成 / 觸發 | ≥ 99% | 🟡 無告警 |
| **訂位正確性** | 無雙重訂位客訴 | 0 件/月 | 🟡 constraint 待套用 |
| **公休日正確性** | 公休日不可訂 | 100% | 🟡 migration 待套用 |
| **系統可用性** | `/book` 可訂位 | 99.5% | 🟢 |

---

## 4. Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Production commit | 🟢 | `4c63223` (#86 closed_dates) |
| Health | 🟢 | `/api/booking-health` → ok |
| CI `main` | 🟢 | 129 unit + E2E |
| **DB parity** | 🔴 | overlap + RBAC + closed_dates migrations |

### 待套用 Migration

- [ ] `migration-reservations-no-overlap.sql`
- [ ] `migration-phase7-rbac.sql`
- [ ] `migration-branches-closed-dates.sql`（Wave 3b）

---

## 5. GitHub 治理（2026-07-11）

### Pull Requests

| PR | 狀態 | 業務判定 | 動作 |
|----|------|----------|------|
| #87 | OPEN Wave 4 | ✅ 營運 — Cron 告警 | 合併 |
| #64, #65 | OPEN dependabot | ✅ 資安 | 修 CI → 合併 |
| #70–#77 | DRAFT/OPEN 幽靈 | 零價值 | **Founder 關閉** |
| #69–#86 | MERGED | — | ✅ Wave 1–3b |

### Issues（7 open）

| Issue | 優先級 | 判定 |
|-------|--------|------|
| #53 付款流程優化 | **P1** | 營收 |
| #54 Epic | P1 | 治理 |
| #59–#62 | P2 | 品質/營運 |
| #61, #63 | 延後 | 無近期業務影響 |

---

## 6. 產品狀態

| 旅程 | 品質 | Δ Round 5 |
|------|------|-----------|
| 後台 RBAC | **A-** | ↑ 訂位路由已 enforce |
| 多分店公休日 | **A-** | ✅ #86 程式上線 |
| 客人訂位 wizard | A- | — |
| 訂金 LINE | A | — |

---

## 7. Business Impact Queue

| Rank | 工作 | 風險 | 營收 | CX | 效率 | 狀態 |
|------|------|:----:|:----:|:--:|:----:|------|
| 1 | 套用 DB migrations | ✅ | ✅ | ✅ | — | **Ops 手動** |
| 2 | 關閉幽靈 PR #70–#77 | ✅ | — | — | ✅ | **Founder** |
| 3 | ~~訂位 RBAC~~ | ✅ | — | — | ✅ | ✅ **#85** |
| 4 | ~~分店 closed_dates~~ | ✅ | ✅ | ✅ | — | ✅ **#86** |
| 5 | Cron 失敗 LINE 告警 | ✅ | ✅ | — | ✅ | **#87 CI** |
| 6 | Dependabot #64/#65 | ✅ | — | — | — | Eng |
| 7 | #53 付款流程優化 | — | ✅ | ✅ | ✅ | P1 |

### 本輪已阻塞（記錄後跳過）

| 工作 | 原因 |
|------|------|
| 關閉 PR #70–#77 | `GraphQL: Resource not accessible by integration` |
| 套用 SQL migration | 需 Supabase Dashboard 手動 |

---

## 8. AI Agent 工作分配

| Agent | 任務 | 狀態 |
|-------|------|------|
| Cloud Agent | Wave 4 Cron 告警 #87 | CI |
| Cloud Agent | Dependabot #64/#65 | 待 #87 |
| Founder | 關 PR、套用 3 個 migration | 手動 |

---

## 9. 每日快照區

```
日期：2026-07-11
Production SHA：4c63223
Open PRs：10+ #87
Open Issues：7
CI main：green
Tests：129
Blockers：migration、幽靈 PR（Founder）
今日最高 ROI：合併 #87 → Dependabot
```

---

## 10. 風險登錄簿

| 風險 | 嚴重度 | 緩解 | 負責 |
|------|--------|------|------|
| Migration 未套用 | 🔴 | Ops 今日 | Ops |
| 幽靈 PR | 🟠 | Founder 關閉 | Founder |
| ~~staff PATCH 訂位~~ | ~~🟠~~ | ✅ #85 | — |
| 公休日全域 | ~~🟠~~ | ✅ #86 | — |
| Cron 靜默失敗 | 🟡 | #87 | Eng |

---

*Round 6 · 下一動作：合併 #87，處理 Dependabot。*
