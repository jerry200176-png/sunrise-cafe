# CTO Operating System v2

**Sunrise Systems · 公司級工程營運系統**  
**版本：** 2.0 · 2026-07-11  
**取代：** Phase 4–8 程式化開發、工程師模式排程

---

## 1. 使命

管理 Sunrise Booking Platform 如同一家 **可持續營運的餐飲科技公司**：

- 最大化 **商業價值**（營收、客戶體驗、營運效率）
- **Company-first：** 優化公司，不是優化 repository
- 工程僅在「比營運／文件／監控／客服改善更有 ROI」時執行

### Company-first 執行規則（Round 8+）

```
每輪：Executive Inbox（全公司信號）→ Decision Log → 最高 ROI 行動
```

| 信號類 | 範例 |
|--------|------|
| Production / Deploy | health、SHA、Vercel |
| Customer | 客訴、訂位失敗、付款糾紛 |
| Business KPI | 訂金率、候補轉換 |
| Financial | 逾期釋放、流失訂金 |
| Security | CVE、audit |
| GitHub | PR/issue（非目標本身） |
| Operational risk | migration、SOP 缺口 |

**非工程行動範例：** Migration Runbook、Weekly Business Review、Payment SOP、監控儀表板設計

### Capability vs Outcome（Round 9+）

| | Capability | Outcome |
|--|------------|---------|
| **定義** | 我們*能做*什麼 | 業務*有改善*（可量測） |
| **範例** | SOP 存在、cron 上線、RBAC 部署 | 訂金率 78%→86%、客訴下降 |
| **Health 計分** | 技術 checklist | **僅** `OUTCOME_LOG` measured 證據 |
| **禁止** | 因新增文件調高 Revenue/CX 分數 | — |

每份營運 artifact 必須登記於 [`OPS_ARTIFACT_REGISTRY.md`](./OPS_ARTIFACT_REGISTRY.md)：owner · review cadence · success metric · retirement criteria。

---

## 2. 價值排序（永久）

所有工作依此排序，**不得**依技術模組（「先做 RBAC」「先做 event bus」）排序：

```
1. Production 穩定性   — 系統能營運嗎？
2. Security            — 會賠錢、賠資料、賠信任嗎？
3. Revenue             — 訂金、轉換、滿房率？
4. Customer Experience — 客人與店員少痛苦？
5. Developer Experience — 僅在上述滿足後
```

---

## 3. 每日節奏（Daily Operating Rhythm）

| 時間 | 動作 | 產出 |
|------|------|------|
| 開工 | **審查 `EXECUTIVE_INBOX.md`** | 信號分類 🔴🟠🟡🟢 |
| 開工 | 更新 Decision Log（若有重排） | DL-NNN 條目 |
| 開工 | `npm run cto:health` + `cto:snapshot` | 計算分數 + 快照 |
| 開工 | 更新 `EXECUTIVE_DASHBOARD.md` §0–§2 | Inbox 摘要 + 分數 |
| 執行 | Business Impact Queue **Rank 1 可執行項** | 1 MDU |
| 完工 | 合併 → 驗證 production → 關閉 Inbox 項目 | Round N+1 |

### 每日自動整理範圍

`scripts/cto-daily-snapshot.sh` 擷取：

- Open / merged PRs（最近 7 天）
- Open issues
- Remote branches
- Tags / latest release
- CI `main` 最近 5 次
- Production `/api/version` + `/api/booking-health`
- 單元測試數量

---

## 4. 每週節奏（Weekly）

| 動作 | 產出 |
|------|------|
| **Outcome Review**（`OPS_WEEKLY_BUSINESS_REVIEW.md`） | `OUTCOME_LOG.md` measured 條目 + Stop list |
| `npm run cto:health` | Outcome 分數僅在 evidence 更新後變動 |
| 檢視營運 KPI §3（Executive Dashboard） | 訂金率、完成率趨勢 |
| 檢視 `OPS_ARTIFACT_REGISTRY` 活躍 artifact | >8 週無 outcome → retire/redesign |
| 刪除已合併 remote branches | 乾淨 repo |
| 關閉已解決 issues | 準確 backlog |
| 更新 `IMPLEMENTATION_TRUTH.md` | 文件 = 程式 |
| 檢視延後項是否仍應延後 | 避免 scope creep |

### Outcome Review 必答三題

1. **本週業務實際變了什麼？**（對照上週 `OUTCOME_LOG`）
2. **哪些營運動作有效／無效？**（誠實記錄，SOP 執行但無改善 = 無改善）
3. **下週該停止什麼？**（避免堆文件、堆 PR、堆會議）

---

## 5. 工作收斂原則

### 最小可交付批次（MDU）

| 規則 | 說明 |
|------|------|
| 一 PR 一問題 | 不順便重構 |
| < 500 行為佳 | 超過需拆分 |
| 可獨立部署 | feature flag 或 additive schema |
| 必須有測試 | 安全／訂位／付款 必測 |
| 必須有 rollback | PR 描述內 |

### 禁止

- 新開 phase 分支堆疊
- 無 issue/PR 的「順便做」
- 同時 3+ 個 open 功能 PR
- 架構文件先於程式 enforce

---

## 6. GitHub 治理規則

| 項目 | 規則 |
|------|------|
| **PR** | 合併後 24hr 內刪除 head branch |
| **Draft PR** | 超過 7 天 → 關閉或拆分重開 |
| **Issue** | 必須通過 Work Gate 四問 |
| **Branch** | 僅 `main` + 進行中 1–2 個 `cursor/*` |
| **Release** | 每次 Wave 完成打 tag（semver） |
| **Dependabot** | 必須啟用；每月檢視 |

---

## 7. AI Agent 編制

| 角色 | 職責 | 本季 KPI |
|------|------|----------|
| **CTO Agent（主）** | Business Impact Queue 執行、PR 合併 | 每週 1–2 個 MDU 上線 |
| **Review Agent** | 上線前檢查 Work Gate | 0 個無四問的 PR |
| **Ops Agent** | Migration checklist、RUNBOOK | 0 schema drift |
| **Founder** | 產品方向、手動 GitHub 權限操作 | 策略 A/B 決策 |

### Agent 不可自主決定

- 產品方向變更
- 破壞性 DB 操作
- 對外銷售 / 定價
- 關閉有付費客戶影響的功能

---

## 8. 與舊流程的關係

| 舊 | 新 |
|----|-----|
| Phase 4–8 roadmap | **廢止** → Business Impact Queue |
| ENGINEERING_DASHBOARD | **升級** → EXECUTIVE_DASHBOARD |
| 技術模組排序 | **廢止** → 價值排序 |
| 11 角色 review board | **廢止** → Work Gate 四問 |
| 38 份架構文件 | **凍結** → SSOT 6 份 |

---

## 9. 成功定義

不是「issues 全關」。

| 指標 | 目標 |
|------|------|
| Production 30 天無 P0 事故 | ✅ |
| 訂金收取率 | ≥ 85% |
| 幽靈 PR / branch | 0 |
| Dashboard 每日更新 | ≥ 5 天/週 |
| 每個 merged PR 有業務影響說明 | 100% |

---

## 10. 相關文件

- `docs/EXECUTIVE_INBOX.md` — 每輪信號收集
- `docs/DECISION_LOG.md` — 優先級決策
- `docs/OPS_ARTIFACT_REGISTRY.md` — 營運 artifact 治理
- `docs/OUTCOME_LOG.md` — 業務 outcome 證據（health 分數來源）
- `docs/OPS_MIGRATION_RUNBOOK.md` — 店長 migration 指南
- `docs/OPS_WEEKLY_BUSINESS_REVIEW.md` — 每週 KPI + Outcome Review
- `docs/OPS_PAYMENT_SOP.md` — 訂金收取 SOP
- `docs/EXECUTIVE_DASHBOARD.md` — 每日儀表板
- `docs/HEALTH_SCORES.md` — 健康度公式（capability vs outcome）
- `docs/CTO_WORK_GATE.md` — 新工作閘門
- `docs/IMPLEMENTATION_TRUTH.md` — 技術事實
- `scripts/cto-daily-snapshot.sh` — 快照腳本
- `scripts/cto-health-scores.sh` — 健康度計算
