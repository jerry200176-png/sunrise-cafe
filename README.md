# 昇昇咖啡訂位系統

昇昇咖啡（大安店）包廂訂位 + 自助點餐系統。

**線上網址**：`https://sunrise-cafe-six.vercel.app`

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
- 包廂管理：定價、圖片、人數、說明
- 菜單管理：分類與品項
- 點餐管理：即時訂單、廚房列印站
- 設定：公休日、訂金說明、付款關鍵字

### 自動化
- 每日 20:00（台灣）推播明日訂位清單至 LINE 群組
- 客人傳付款關鍵字/截圖 → 自動標記已付訂金 + 通知群組

---

## 技術棧

- **Next.js 15** App Router、TypeScript、Tailwind CSS
- **Supabase**（PostgreSQL + Realtime）
- **Vercel**（Serverless + Cron Job）
- **LINE Messaging API**（群組通知 + 客人個人通知）
- **print-bridge**（本機 Node.js，熱感印表機）

---

## 本機開發

```bash
# 1. 複製環境變數
cp .env.local.example .env.local
# 填入 Supabase、LINE、ADMIN_PASSWORD 等變數（見 docs/ENV.md）

# 2. 安裝依賴
npm install

# 3. 啟動開發伺服器
npm run dev
# → http://localhost:3000
```

> DNS 繞過已寫入 npm scripts，Windows 環境可直接用。

---

## 部署

推送到 `main` 分支，Vercel 自動 build 並部署。

手動部署：
```bash
vercel --prod
```

環境變數管理見 [docs/ENV.md](docs/ENV.md)。
初次部署流程見 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

---

## 文件索引

| 文件 | 說明 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | AI 工作手冊（架構、地雷、關鍵檔案） |
| [CHANGELOG.md](CHANGELOG.md) | 版本異動紀錄 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系統架構與資料流 |
| [docs/LINE.md](docs/LINE.md) | LINE 整合說明與換帳號步驟 |
| [docs/ENV.md](docs/ENV.md) | 所有環境變數說明 |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | 常見操作與問題排查 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 重要技術決策記錄（ADR） |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 初次部署指南 |

---

## 授權

私人專案。
