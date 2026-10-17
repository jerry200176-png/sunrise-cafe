# 昇昇咖啡訂位系統 — 產品說明

**版本：** v2 · **線上：** https://sunrise-cafe-six.vercel.app  
**適用對象：** 餐飲業主、店長、加盟評估、技術合作方

---

## 解決什麼問題

包廂餐飲最常見的三個痛點：

1. **訂位與滿房管理** — 電話、LINE 混亂，容易雙重預約  
2. **訂金收取** — 週末/假日座位需訂金，人工對帳耗時  
3. **店內營運** — 明日訂位、取消釋放、候補通知需即時同步

本系統將 **訂位 → 訂金 → 提醒 → 後台營運** 串成單一平台，並以 LINE 作為客人與店內群組的主要介面。

---

## 使用者與價值

| 角色 | 功能 | 商業價值 |
|------|------|----------|
| **客人** | 線上選時段、查詢/取消、LINE 收訂金通知 | 降低電話負擔、提高預約完成率 |
| **店長** | 後台確認訂位、審核付款截圖、發送提醒 | 訂金到帳可追蹤、減少糾紛 |
| **廚房/吧台** | QR 點餐、列印站 | 包廂內自助加點 |
| **創辦人** | 執行儀表板、North Star KPI、多分店設定 | 數據驅動營運決策 |

---

## 核心能力

- 多分店 / 多包廂時段管理（含重疊防護）  
- LINE 雙 Bot：客人個人通知 + 店內群組營運推播  
- 訂金期限與提醒（逾期不自動取消，ADR-012）、候補通知  
- 付款截圖審核工作流（`pending_review` → 核准/拒絕）  
- 明日訂位 Cron 提醒（每日 20:00 台灣時間）  
- 執行儀表板 `/admin/executive`：訂金率、候補轉換、付款 SLA

---

## 成效指標（North Star）

| 指標 | 目標 | 量測方式 |
|------|------|----------|
| 訂金轉換率 | ≥85% | 30 天內已付訂金 / 應付訂金 |
| 候補轉換率 | ≥30% | 候補成功訂位 / 加入候補 |
| 付款審核 SLA | ≥90% 在 4h 內 | `payment_events.reviewed_at` |
| 訂位漏斗轉換 | ≥65% | 進入訂位流程 → 完成建立 |

詳見 [`NORTH_STAR_METRICS.md`](./internal/executive/NORTH_STAR_METRICS.md)（內部）或線上 `/admin/executive`。

---

## 技術概要

- **前端/後端：** Next.js 15、TypeScript、Tailwind  
- **資料庫：** Supabase PostgreSQL  
- **部署：** Vercel（含 Cron）  
- **通知：** LINE Messaging API  
- **列印：** print-bridge（店內本機服務）

架構詳見 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

---

## 路線圖摘要

公開路線圖見 [`ROADMAP.md`](./ROADMAP.md)。

---

## 聯絡與支援

- **線上系統：** https://sunrise-cafe-six.vercel.app  
- **安全回報：** [`SECURITY.md`](../SECURITY.md)  
- **維運手冊：** [`RUNBOOK.md`](./RUNBOOK.md)
