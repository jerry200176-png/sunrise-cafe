# Executive Dashboard — Sunrise Systems

**CTO Operating System v2 · 單一真實來源（SSOT）**  
**最後更新：** 2026-07-11 Round 4（每日快照）  
**Production：** https://sunrise-cafe-six.vercel.app · `v2.2.0` · `fbf09d4`

> 取代 `ENGINEERING_DASHBOARD.md` 為每日營運起點。  
> 技術事實以 `IMPLEMENTATION_TRUTH.md` 為準；策略以 `CTO_STRATEGY.md` 為準。

---

## 1. Executive Summary（30 秒）

| 指標 | 狀態 |
|------|------|
| **平台能否營運？** | 🟢 是 — production 健康、CI 綠燈 |
| **能否安全聘請員工？** | 🟡 部分 — 付款 RBAC 已上線；訂位 PATCH 尚待 Wave 3 |
| **能否多分店？** | 🟡 部分 — RBAC 就緒；`closed_dates` 仍為全域設定 |
| **最大業務風險** | DB migration 未套用、7 個幽靈 PR 未關閉 |
| **本週最高 ROI** | 套用 migration → 訂位 RBAC → 分店公休日 |

---

## 2. 健康度計分卡

| 維度 | 分數 | 目標 | 趨勢 | 負責 |
|------|------:|-----:|------|------|
| **工程健康** | 84 | 95 | ↑ | CTO / Eng |
| **資安** | 88 | 95 | ↑ | Security |
| **產品** | 76 | 85 | → | Product |
| **營收可靠性** | 75 | 90 | → | Ops |
| **客戶體驗** | 74 | 85 | ↑ | Product |
| **部署／營運** | 86 | 95 | ↑ | SRE |
| **GitHub 治理** | 58 | 90 | ↓ | CTO |
| **整體** | **80** | 90 | ↑ | CEO |

**GitHub 治理分數低的原因：** 10 個 open PR（8 個已廢棄）、Dependabot 未啟用、幽靈分支引用。

---

## 3. 營運 KPI（業務面）

| KPI | 定義 | 目標 | 量測方式 | 現況 |
|-----|------|------|----------|------|
| **訂位完成率** | `booking_completed ÷ booking_started` | ≥ 70% | `analytics_events` | 📊 需每週查 `/admin/insights` |
| **訂金收取率** | 期限內 `is_deposit_paid=true` | ≥ 85% | `reservations` | 📊 後台手動 |
| **候補轉換率** | `waitlist.booked ÷ joined` | ≥ 30% | `waitlist` 表 | 📊 後台 |
| **Cron 成功率** | 提醒 job 完成 / 觸發 | ≥ 99% | Vercel logs（待自動化） | 🟡 無告警 |
| **訂位正確性** | 無雙重訂位客訴 | 0 件/月 | 營運回報 | 🟢 exclusion constraint（待套用） |
| **付款審核 SLA** | 截圖 → 審核完成時間 | < 4hr | `payment_events` | 📊 手動 |
| **系統可用性** | `/book` 可訂位 | 99.5% | Vercel + health | 🟢 |

**營收 KPI 優先於工程 KPI。** 若一項工程工作無法改善上表任一欄，降低優先級。

---

## 4. Production & Deployment

| 信號 | 狀態 | 證據 |
|------|------|------|
| Production commit | 🟢 | `/api/version` → `fbf09d4` |
| Health | 🟢 | `/api/booking-health` → `{"ok":true}` |
| Vercel deploy | 🟢 | `main` 自動部署 |
| CI `main` | 🟢 | Lint + 119 tests + build + E2E |
| Verify Production | 🟢 | SHA smoke post-merge |
| Release tag | 🟢 | `v2.2.0` |
| **DB parity** | 🔴 | overlap + RBAC migration **待套用** |

### 待套用 Migration（阻擋營運擴張）

- [ ] `supabase/migration-reservations-no-overlap.sql`
- [ ] `supabase/migration-phase7-rbac.sql`

---

## 5. GitHub 治理（每日快照 2026-07-11）

### Pull Requests

| PR | 狀態 | 業務判定 | 動作 |
|----|------|----------|------|
| #64, #65 | OPEN dependabot | 降低資安風險 | 修 CI → 合併 |
| #70–#76 | DRAFT 幽靈 | **零業務價值** | **立即關閉** |
| #77 | OPEN 重複 | 零（#78 已合併） | **立即關閉** |
| #69–#83 | MERGED | — | ✅ Wave 1–2 完成 |

### Issues（7 open）

| Issue | 業務影響問答 | 優先級 |
|-------|-------------|--------|
| #53 付款流程優化 | ✅ 提升營收（訂金轉換） | **P1** |
| #54 Epic 生產卓越 | 治理用 | P1 更新 checklist |
| #62 銀行 CSV 對帳 | ✅ 降低營運人工 | P2 |
| #59 E2E 擴充 | ✅ 降低回歸風險 | P2 |
| #60 結構化日誌 | ✅ 降低故障診斷時間 | P2 |
| #61 AI workflow 文件 | ⚠️ 僅提升 agent 效率 | **P3 延後** |
| #63 PaymentProvider | ❌ 無近期營收 | **延後** |

### Branches（remote）

| Branch | 狀態 |
|--------|------|
| `main` | ✅ Production |
| `dependabot/*` (2) | 待合併 |
| `cursor/*` | ✅ 已清理 |

### Releases

| Tag | 日期 | 內容 |
|-----|------|------|
| v2.2.0 | 2026-07-10 | RBAC + 付款權限 |
| v2.1.0 | 2026-07-10 | 安全 + 客人驗證 |
| v1.1.0 | 2026-05-16 | 舊版 |

### CI（最近 3 次 main）

| Run | 結果 |
|-----|------|
| #83 merge | ✅ CI + Verify Production |
| #82 merge | ✅ CI |
| #81 merge | ✅ CI |

---

## 6. 產品狀態

| 旅程 | 品質 | 業務影響 |
|------|------|----------|
| 客人訂位 wizard | A- | 核心營收入口 |
| 訂金 LINE 流程 | A | 台灣市場護城河 |
| 候補 | B+ | 滿房時營收恢復 |
| 後台付款審核 | B+ | 營運每日必用 |
| 後台 RBAC | B | 可建帳號；路由未全覆蓋 |
| 多分店公休日 | C | **錯誤可訂 = 流失信任** |
| 數據儀表板 | C+ | 有價值但非每日必開 |

---

## 7. Business Impact Queue（唯一排序）

**不按技術模組排序。按公司價值排序。**

| Rank | 工作 | 降低風險 | 提升營收 | 改善體驗 | 提升效率 | 狀態 |
|------|------|:--------:|:--------:|:--------:|:--------:|------|
| 1 | 套用 DB migrations | ✅ | ✅ | ✅ | — | **Ops** |
| 2 | 關閉幽靈 PR #70–#77 | ✅ | — | — | ✅ | Founder |
| 3 | Wave 3：訂位路由 RBAC | ✅ | — | — | ✅ | Eng |
| 4 | Wave 3：分店 `closed_dates` | ✅ | ✅ | ✅ | — | Eng |
| 5 | Dependabot #64/#65 | ✅ | — | — | — | Eng |
| 6 | Cron 失敗 LINE 告警 | ✅ | ✅ | — | ✅ | Eng |
| 7 | #53 付款流程優化 | — | ✅ | ✅ | ✅ | Product+Eng |
| 8 | #62 銀行 CSV 對帳 | — | ✅ | — | ✅ | Eng |

### 已降級／延後（無法回答業務影響問答）

| 工作 | 原因 |
|------|------|
| Phase 4–8 平台計畫 | 無簽約加盟、無外部租戶 |
| AI 賓客服務 | 品牌風險 > 營收 |
| PaymentProvider (#63) | 無付費閘道決策 |
| AI workflow docs (#61) | 僅 agent 效率，無客戶價值 |
| Microservices 評估 | 無規模證據 |

---

## 8. AI Agent 工作分配

| Agent 角色 | 本週任務 | 產出 | 禁止 |
|------------|----------|------|------|
| **Cloud Agent（主）** | Wave 3 訂位 RBAC | 1 PR + tests | 新 phase 分支 |
| **Cloud Agent（主）** | `closed_dates` 修復 | 1 PR | 順便重構 admin UI |
| **Founder** | 關 PR、啟用 Dependabot、套用 SQL | 3 項手動 | — |
| **Agent（文件）** | 每日更新本 Dashboard 快照區 | §9 更新 | 新建 38 份架構 doc |

### Agent 開工閘門（四問）

每個新 PR / Issue **必須**填寫：

1. **降低什麼風險？**（若無 → 非 P0/P1）
2. **如何提升營收？**（訂金、轉換、滿房率）
3. **如何改善客戶體驗？**（客人或店員）
4. **如何提升開發效率？**（若僅此項 → P2 以下）

模板：`docs/CTO_WORK_GATE.md`

---

## 9. 每日快照區（Daily Snapshot）

_由 `npm run cto:snapshot` 或手動更新。_

```
日期：2026-07-11
Production SHA：fbf09d4
Open PRs：10（7 draft 應關閉）
Open Issues：7
CI main：green
Tests：119
Blockers：7 draft PR、migration 未套用
今日最高 ROI：#1 套用 migration
```

---

## 10. 風險登錄簿

| 風險 | 嚴重度 | 緩解 | 負責 |
|------|--------|------|------|
| Migration 未套用 | 🔴 | Ops 今日套用 | Ops |
| 幽靈 PR 混淆決策 | 🟠 | Founder 關閉 | Founder |
| `staff` 可 PATCH 訂位 | 🟠 | Wave 3 | Eng |
| 錯誤公休日 | 🟠 | Wave 3 | Eng |
| Dependabot 停用 | 🟡 | Settings | Founder |
| Cron 靜默失敗 | 🟡 | Wave 4 | Eng |

---

## 11. 文件階層（SSOT）

```
docs/EXECUTIVE_DASHBOARD.md   ← 每日起點（本文件）
docs/IMPLEMENTATION_TRUTH.md  ← 程式實際狀態
docs/CTO_OS_V2.md             ← 作業系統手冊
docs/CTO_WORK_GATE.md         ← 新工作四問閘門
docs/CTO_STRATEGY.md          ← 策略
docs/MIGRATIONS.md            ← DB
CLAUDE.md                     ← 店員操作手冊
```

---

*下一輪更新：Wave 3 合併後或每日快照執行後。*
