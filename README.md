# 昇昇咖啡訂位系統

為台灣餐飲業設計的 **包廂訂位 + LINE 訂金 + 後台營運** 平台。  
服務昇昇咖啡（大安店）日常營運，支援多分店擴展。

[![CI](https://github.com/jerry200176-png/sunrise-cafe/actions/workflows/ci.yml/badge.svg)](https://github.com/jerry200176-png/sunrise-cafe/actions/workflows/ci.yml)
[![Production](https://img.shields.io/badge/production-live-brightgreen)](https://sunrise-cafe-six.vercel.app)
[![Health](https://img.shields.io/badge/health-/api/booking--health-blue)](https://sunrise-cafe-six.vercel.app/api/booking-health)

**線上網址：** https://sunrise-cafe-six.vercel.app

---

## 目錄

- [功能](#功能)
- [產品說明](#產品說明)
- [架構](#架構)
- [本機開發](#本機開發)
- [測試](#測試)
- [CI/CD](#cicd)
- [部署](#部署)
- [維運](#維運)
- [文件](#文件)
- [安全](#安全)

---

## 功能

### 客人端
- 選分店 / 包廂 / 日期時段，線上預約包廂
- 以電話查詢訂位、24 小時前可取消
- LINE Login 綁定，接收訂金請求與提醒通知
- 自助點餐（QR 桌位牌掃碼進入）

### 後台
- 訂位列表：確認、取消、發送 LINE 訂金通知
- 儀表板：今日統計、可用包廂、時間軸視圖
- 付款審核：截圖審核、SLA 追蹤
- 執行儀表板 `/admin/executive`：North Star KPI
- 包廂 / 菜單 / 點餐 / 多分店管理

### 自動化
- 每日 20:00（台灣）推播明日訂位清單至 LINE 群組
- 訂金逾期自動釋放 + 候補通知
- 付款截圖 → 審核工作流 → 群組通知

---

## 產品說明

對外產品介紹、成效指標、路線圖：

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — 產品價值與能力
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 公開路線圖
- [`docs/OPS_MULTI_BRANCH.md`](docs/OPS_MULTI_BRANCH.md) — 多分店開店 playbook

---

## 架構

| 層 | 技術 |
|---|---|
| Frontend/Backend | Next.js 15 App Router, TypeScript, Tailwind CSS |
| Database | Supabase (PostgreSQL + Realtime) |
| 部署 | Vercel（含 Cron Job） |
| 通知 | LINE Messaging API（群組 + 客人雙 Bot） |
| 列印 | print-bridge（店內本機 Node.js） |

詳見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

```
客人瀏覽器 / LINE
    ↓
Next.js (Vercel)
    ↓
Supabase PostgreSQL ← Realtime
    ↓
LINE API · Sentry · Cron
```

---

## 本機開發

```bash
cp .env.local.example .env.local   # 見 docs/ENV.md
npm install
npm run dev
# → http://localhost:3000
```

---

## 測試

```bash
npm test              # Vitest 單元測試
npm run lint          # ESLint
npm run verify:migrations
npm run test:e2e      # Playwright（需先 npm run build）
```

CI 於每個 PR 與 `main` push 自動執行。

---

## CI/CD

| 階段 | 說明 |
|------|------|
| PR | Lint → Unit tests → Migration verify → Build → E2E smoke |
| Merge `main` | Vercel production deploy |
| Post-deploy | `verify-production` 比對 `/api/version` SHA |

---

## 部署

推送到 `main` 後 Vercel 自動部署 production。

```bash
vercel --prod   # 手動部署（見 docs/RUNBOOK.md）
```

環境變數：[`docs/ENV.md`](docs/ENV.md) · 初次部署：[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

---

## 維運

| 項目 | 位置 |
|------|------|
| 常見問題 | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| LINE 設定 | [`docs/LINE.md`](docs/LINE.md) |
| 付款流程 | [`docs/OPS_PAYMENT_SOP.md`](docs/OPS_PAYMENT_SOP.md) |
| DB migration | [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) |
| 健康檢查 | `GET /api/booking-health` |
| 版本 | `GET /api/version` |

---

## 文件

### 公開（貢獻者 / 合作方）

| 文件 | 說明 |
|------|------|
| [PRODUCT.md](docs/PRODUCT.md) | 產品價值與能力 |
| [ROADMAP.md](docs/ROADMAP.md) | 公開路線圖 |
| [OPS_MULTI_BRANCH.md](docs/OPS_MULTI_BRANCH.md) | 多分店開店 playbook |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系統架構 |
| [ENV.md](docs/ENV.md) | 環境變數 |
| [RUNBOOK.md](docs/RUNBOOK.md) | 維運手冊 |
| [PAYMENT_STATE_MODEL.md](docs/PAYMENT_STATE_MODEL.md) | 付款狀態機 |
| [RBAC.md](docs/RBAC.md) | 權限模型 |
| [DECISIONS.md](docs/DECISIONS.md) | 技術決策 ADR |
| [CHANGELOG.md](CHANGELOG.md) | 版本紀錄 |

### 內部工程（可選）

Agent / CTO 工作流文件：[`docs/internal/README.md`](docs/internal/README.md)

---

## 安全

- Admin API session 驗證 + RBAC
- Rate limiting（Upstash，未設定時 fail-open）
- Sentry 錯誤追蹤
- 漏洞回報：[`SECURITY.md`](SECURITY.md)

---

## 授權

私人專案 · 昇昇咖啡
