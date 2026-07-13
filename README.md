# 昇昇咖啡訂位系統

### 客人訂完就走，店裡不用追 LINE 截圖對帳到天亮。

為台灣餐飲業設計的 **包廂訂位 + LINE 訂金 + 後台營運** 平台。  
服務昇昇咖啡（大安店）日常營運，架構可擴至多分店。

[![CI](https://github.com/jerry200176-png/sunrise-cafe/actions/workflows/ci.yml/badge.svg)](https://github.com/jerry200176-png/sunrise-cafe/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com)
[![Production](https://img.shields.io/badge/production-live-brightgreen)](https://sunrise-cafe-six.vercel.app)
[![Health](https://img.shields.io/badge/health-/api/booking--health-blue)](https://sunrise-cafe-six.vercel.app/api/booking-health)

**線上網址：** https://sunrise-cafe-six.vercel.app

---

## 目錄

- [為什麼需要這套系統](#為什麼需要這套系統)
- [它是怎麼運作的](#它是怎麼運作的)
- [核心能力](#核心能力)
- [系統架構](#系統架構)
- [與其他做法的差異](#與其他做法的差異)
- [快速開始](#快速開始)
- [測試與品質](#測試與品質)
- [CI/CD 與部署](#cicd-與部署)
- [維運手冊](#維運手冊)
- [文件索引](#文件索引)
- [安全](#安全)

---

## 為什麼需要這套系統

多數小型餐廳的訂位仍靠 **LINE 私訊 + 手寫登記 + 截圖對帳**：

- 客人問「還有包廂嗎？」店員要翻聊天紀錄、對照滿房表
- 訂金截圖散落在群組，誰付過、誰沒付，要靠人工記憶
- 逾期未付的訂位不敢釋放，怕得罪客人；放了又怕雙重訂位
- 候補客人要靠店員手動通知，常常錯過黃金時間

**昇昇系統把這些變成可預測的流程**——客人自助訂位、系統追訂金、逾期自動釋放、候補自動通知；店員在後台審核、確認、看 KPI，而不是在 LINE 裡當人肉資料庫。

---

## 它是怎麼運作的

**客人訂位 → 系統鎖檔 → LINE 收訂金 → 店員審核 → 營運數據回流。**

1. 客人在網站選分店、包廂、時段，送出訂位
2. 後台確認後，**客人 Bot** 推送訂金請求；**群組 Bot** 通知店內有新單
3. 客人回傳付款截圖或關鍵字 → 進入審核佇列（或符合規則時自動標記）
4. 訂金逾期 → Cron 自動釋放名額 → 觸發候補通知
5. 每日 20:00（台灣）→ 群組收到明日訂位清單
6. Executive Dashboard 彙整訂金率、審核 SLA、部署健康——**用數據決策，不靠感覺**

工程面還有一層 **AI Engineering Orchestrator**：任務牆排序下一項工作、自主迴圈在 GitHub 上持續合併改進、失敗時寫入學習紀錄而非原地打轉。（見 [工程自主運轉](#4-工程自主運轉)）

---

## 核心能力

### 1. 客人端體驗

- 選分店 / 包廂 / 日期時段，線上預約包廂（手機優先、繁中/英文）
- 以電話查詢訂位、24 小時前可取消
- LINE Login 綁定，接收訂金請求與提醒
- 自助點餐（QR 桌位牌掃碼進入）

### 2. 店員後台

- 訂位列表：確認、取消、發送 LINE 訂金通知
- 儀表板：今日統計、可用包廂、時間軸視圖
- 付款審核：截圖審核、SLA 追蹤（[`/admin/payments`](https://sunrise-cafe-six.vercel.app/admin/payments)）
- 多分店、包廂、菜單、點餐訂單管理
- **Executive Dashboard** [`/admin/executive`](https://sunrise-cafe-six.vercel.app/admin/executive)：North Star KPI、營運風險、工程任務牆

### 3. 營運自動化

- 每日 **20:00 台灣時間** 推播明日訂位至 LINE 群組（多分店各自推播）
- 訂金逾期自動釋放 + 候補通知（期限 = min(建立後 24h, 訂位開始時間)）
- 付款截圖 → `payment_events` 審核工作流 → 群組/客人通知
- Cron 健康、部署 SHA parity、migration 狀態——Executive API 即時可查

### 4. 工程自主運轉

借鑑 [AI-company](https://github.com/CronusL-1141/AI-company) 任務牆 / 失敗煉金 / 停滯偵測概念，以 **bash + GitHub Actions** 落地（無額外 Python 後端）：

| 機制 | 說明 | 入口 |
|------|------|------|
| **Task Wall** | 評分排序下一項可執行工程任務 | `npm run cto:task-wall` · `GET /api/admin/orchestrator` |
| **Autonomous Loop** | 每日無人值守迭代：選任務 → 實作 → PR → 合併 | `.github/workflows/autonomous-loop.yml` |
| **Failure Alchemy** | CI/驗證失敗時寫入防禦規則與案例 | `orchestrator/failure-learnings.jsonl` |
| **Stall Check** | 72h 無迭代、PR 卡住、重複失敗時告警 | `npm run cto:stall-check` |
| **Governance Gate** | 生產穩定 / GitHub 衛生未過則優先治理任務 | `npm run cto:governance` |

完整對照與採用決策：[`docs/internal/automation/AI_COMPANY_ADOPTION.md`](docs/internal/automation/AI_COMPANY_ADOPTION.md)  
工程 SSOT：[`docs/internal/automation/ORCHESTRATOR.md`](docs/internal/automation/ORCHESTRATOR.md)

---

## 系統架構

### 產品層（客人與店員）

```
┌─────────────────────────────────────────────────────────────┐
│  客人瀏覽器 / LINE App          店員瀏覽器 / Admin           │
│       │                              │                      │
│       └──────────────┬───────────────┘                      │
│                      │ HTTPS                                │
│               ┌──────▼──────┐                               │
│               │   Vercel     │  Next.js 15 App Router       │
│               │  Serverless  │  /book · /order · /admin     │
│               │  + Cron Jobs │  /api/* · RBAC session       │
│               └──────┬──────┘                               │
│          ┌───────────┼────────────┐                         │
│          ▼           ▼            ▼                         │
│     Supabase     LINE API     Sentry / Upstash              │
│   PostgreSQL    雙 Bot 架構    監控 / Rate limit             │
│                                                             │
│  店內電腦 ── print-bridge (Node.js) ── 熱感印表機            │
└─────────────────────────────────────────────────────────────┘
```

### 工程層（持續改進）

```
┌─────────────────────────────────────────────────────────────┐
│              CTO Orchestrator (bash + JSON SSOT)             │
│   discover → prioritize → plan → execute → verify → record   │
│         │              │              │                     │
│         ▼              ▼              ▼                     │
│   task-catalog    task-wall.json   autonomous-loop.yml       │
│   priority.json   stall.json       GitHub PR / merge         │
│                   failure-learnings.jsonl                     │
│         │                                                   │
│         ▼                                                   │
│   /admin/executive  ·  GET /api/admin/orchestrator         │
└─────────────────────────────────────────────────────────────┘
```

### 技術棧

| 層 | 技術 |
|---|---|
| Frontend / Backend | Next.js 15 App Router, TypeScript, Tailwind CSS |
| Database | Supabase (PostgreSQL + Realtime) |
| 部署 | Vercel（含 Cron Job） |
| 通知 | LINE Messaging API（**群組 Bot** + **客人 Bot**，見 [`docs/LINE.md`](docs/LINE.md)） |
| 列印 | print-bridge（店內本機 Node.js，不部署 Vercel） |
| 觀測 | Sentry · structured ops-log · Executive outcome API |

模組與路由詳解：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 與其他做法的差異

| 面向 | LINE 人工 + 表格 | 通用訂位 SaaS | 昇昇系統 |
|------|------------------|---------------|----------|
| **台灣 LINE 訂金** | 截圖散落群組 | 多半不支援或需另接金流 | 雙 Bot + 審核佇列 + 話術資料庫驅動 |
| **逾期釋放** | 店員不敢放 | 固定規則，難客製 | min(24h, 訂位開始) + 候補自動通知 |
| **多分店** | 每店一套群組 | 常見但 LINE 整合弱 | `branches.line_group_id` 各自推播 |
| **後台 KPI** | 無 | 報表偏銷售 | Executive：訂金率、審核 SLA、部署/migration |
| **工程演進** | 外包一次交件 | 平台方 roadmap | 自主 orchestrator + task wall + GHA loop |
| **資料主權** | 分散在聊天室 | 平台託管 | 自架 Supabase + 可 fork 擴展 |

產品定位與路線圖：[`docs/PRODUCT.md`](docs/PRODUCT.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)

---

## 快速開始

### 環境需求

- Node.js **20+**
- npm
- Supabase 專案（見 [`docs/ENV.md`](docs/ENV.md)）
- LINE Developers 兩組 Channel（群組 + 客人）

### 本機開發

```bash
git clone https://github.com/jerry200176-png/sunrise-cafe.git
cd sunrise-cafe
cp .env.local.example .env.local   # 填入 Supabase / LINE 等變數
npm install
npm run dev
# → http://localhost:3000
```

### 工程指揮（可選）

```bash
npm run cto:orchestrator    # 發現信號 → 排序任務 → 產出 ORCHESTRATOR_PLAN.md
npm run cto:task-wall       # 更新任務牆 JSON
npm run cto:governance      # 治理 gate（PASS 才能衝功能）
npm run cto:outcomes        # 擷取 Executive KPI 快照
```

---

## 測試與品質

```bash
npm test                  # Vitest 單元測試（180+）
npm run lint              # ESLint
npm run verify:migrations # DB migration 一致性
npm run build && npm run test:e2e   # Playwright E2E
```

設計規範（觸控目標、safe-area、Warm Artisan 視覺）：[`DESIGN.md`](DESIGN.md)

---

## CI/CD 與部署

| 階段 | 說明 |
|------|------|
| PR | Lint → Unit tests → Migration verify → Build → Playwright |
| Merge `main` | Vercel production deploy |
| Post-deploy | `verify-production` 比對 `/api/version` SHA |
| 每日 | `autonomous-loop.yml` 自主工程迭代（bounded） |
| 每日 | `orchestrator.yml` 心跳 + plan artifact |

```bash
vercel --prod   # 手動部署（見 docs/RUNBOOK.md）
```

環境變數：[`docs/ENV.md`](docs/ENV.md) · 初次部署：[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

---

## 維運手冊

| 情境 | 去哪裡 |
|------|--------|
| 訂位/付款異常 | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| LINE 雙 Bot 設定 | [`docs/LINE.md`](docs/LINE.md) |
| 付款 SOP | [`docs/OPS_PAYMENT_SOP.md`](docs/OPS_PAYMENT_SOP.md) |
| DB migration | [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) · `npm run verify:migrations` |
| 多分店開店 | [`docs/OPS_MULTI_BRANCH.md`](docs/OPS_MULTI_BRANCH.md) |
| 健康檢查 | `GET /api/booking-health` |
| 版本 / SHA | `GET /api/version` |
| Executive 即時 KPI | `GET /api/admin/outcomes` · `/admin/executive` |

---

## 文件索引

### 產品與架構（公開）

| 文件 | 說明 |
|------|------|
| [PRODUCT.md](docs/PRODUCT.md) | 產品價值與能力 |
| [ROADMAP.md](docs/ROADMAP.md) | 公開路線圖 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 模組、API、資料表 |
| [DESIGN.md](DESIGN.md) | UI/UX 設計規範 |
| [ENV.md](docs/ENV.md) | 環境變數 |
| [RUNBOOK.md](docs/RUNBOOK.md) | 維運手冊 |
| [PAYMENT_STATE_MODEL.md](docs/PAYMENT_STATE_MODEL.md) | 付款狀態機 |
| [RBAC.md](docs/RBAC.md) | 後台權限 |
| [DECISIONS.md](docs/DECISIONS.md) | 技術決策 ADR |
| [CHANGELOG.md](CHANGELOG.md) | 版本紀錄 |

### 工程與自主運轉（內部）

| 文件 | 說明 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | Agent 工作手冊（架構地雷、LINE 雙 channel） |
| [internal/README.md](docs/internal/README.md) | 內部文件總索引 |
| [ORCHESTRATOR.md](docs/internal/automation/ORCHESTRATOR.md) | 工程編排 SSOT |
| [AI_COMPANY_ADOPTION.md](docs/internal/automation/AI_COMPANY_ADOPTION.md) | AI-company 參考評估 |
| [CTO_OS_V2.md](docs/internal/automation/CTO_OS_V2.md) | 公司級工程節奏 |

---

## 安全

- Admin session 驗證 + RBAC（`owner` / `branch_manager` / `staff` / `finance`）
- Rate limiting（Upstash；未設定時 fail-open）
- Sentry 錯誤追蹤
- 漏洞回報：[`SECURITY.md`](SECURITY.md)

---

## 授權

私人專案 · 昇昇咖啡
