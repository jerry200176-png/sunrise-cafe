# CLAUDE.md — 昇昇咖啡訂位系統 AI 工作手冊

## 專案概述

昇昇咖啡（大安店）包廂訂位 + 自助點餐系統。客人可線上預約包廂、查詢/取消訂位；後台管理訂位、包廂、點餐與報表。

**線上網址**：`https://sunrise-cafe-six.vercel.app`

---

## 技術棧

| 層 | 技術 |
|---|---|
| Frontend/Backend | Next.js 15 App Router, TypeScript, Tailwind CSS |
| Database | Supabase (PostgreSQL + Realtime) |
| 部署 | Vercel（含 Cron Job） |
| 通知 | LINE Messaging API（兩個 channel） |
| 列印 | print-bridge（獨立 Node.js，非 Vercel） |

---

## 關鍵架構決策

### LINE 雙 Channel 架構（最容易搞混）

系統有**兩個獨立的 LINE Official Account**：

```
群組 Bot（LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET）
  → 推播明日訂位提醒到 LINE 群組
  → Webhook 驗證用此 secret（/api/webhooks/line）
  → 客人付款時群組收到通知

客人 Bot（LINE_CUSTOMER_ACCESS_TOKEN）
  → Push 訂金請求給客人（個人訊息）
  → 回覆客人付款確認
```

換任一 Bot 時，記得同步更新 `.env.local` 和 Vercel 環境變數。
換群組 Bot 時，還需在新 channel 設定 Webhook URL。

### 時區陷阱

Vercel 伺服器跑 UTC，顯示時間**必須**轉換：

```ts
// 正確做法
const toTaipei = (s: string) =>
  new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

// 錯誤：直接用 new Date() 或 parseISO() 不轉換
```

### Cron Job

`vercel.json` 設定 `"0 12 * * *"` = UTC 12:00 = **台灣時間 20:00**，每日自動推播明日訂位提醒到群組。

### 目前只推大安店

`/api/admin/reminders/send-line` 只篩 `branch.name.includes("大安店")` 的訂位發到群組。

---

## 關鍵檔案位置

```
src/
  lib/
    line-notify.ts        # 群組通知（LINE_CHANNEL_ACCESS_TOKEN）
    line.ts               # 客人個人通知（LINE_CUSTOMER_ACCESS_TOKEN）
    supabase-admin.ts     # 後台 Supabase 操作
    booking-utils.ts      # 訂位計算邏輯
  app/
    api/
      webhooks/line/      # LINE Webhook：付款偵測 + 自動標記
      admin/reminders/    # 明日提醒 Cron + 手動觸發
      admin/diagnose-line/ # 診斷兩個 token 狀態
supabase/
  schema.sql              # 完整資料庫 schema
  migration-*.sql         # 歷史 migration（依序執行）
print-bridge/             # 本地列印服務（獨立部署，非 Vercel）
```

---

## 付款自動化流程

```
客人傳訊息/截圖給客人 Bot
  → webhook 偵測付款關鍵字（可後台自訂）
  → 更新 reservations.is_deposit_paid = true
  → 推播「客人已付訂金」到群組（群組 Bot）
  → 自動回覆客人確認
```

付款關鍵字排除問句（含「嗎」「？」「如何」等），避免誤判。

---

## 關鍵檔案位置（更新）

```
src/
  lib/
    rate-limit.ts           # Upstash Rate Limiting（未設定時 fail-open）
    waitlist.ts             # 等位清單通知邏輯
  app/
    api/
      admin/reports/        # 營收報表 API
      waitlist/             # 等位 CRUD API
    admin/reports/          # 報表頁面（Recharts）
    book/waitlist/          # 等位表單頁面
instrumentation.ts          # Sentry server/edge 初始化
instrumentation-client.ts   # Sentry client 初始化
sentry.*.config.ts          # Sentry 設定（三個 runtime）
.github/workflows/ci.yml    # GitHub Actions CI（Lint + Build）
```

## 多分店 LINE 推播

分店可在後台設定 `line_group_id`（branches 表）。Cron 會自動對所有有設定的分店各自推播。若無分店設定，fallback 到 `LINE_GROUP_ID` 環境變數（向下相容）。

## 等位清單觸發點

取消訂位的兩個地方都會觸發等位通知：
- `src/app/api/cancel-booking/route.ts`（客人自行取消）
- `src/app/api/reservations/[id]/route.ts`（後台取消）

## 常見地雷

- **Supabase 免費方案**：閒置 7 天會暫停，需手動到 Dashboard 恢復
- **Vercel 環境變數更新後**需 Redeploy 才生效
- `LINE_CHANNEL_SECRET` 同時用於 webhook 簽章驗證，換群組 Bot 後需確認 webhook URL 設定在新 channel
- `print-bridge/` 是本機 Node.js 服務，不部署到 Vercel，需在店內電腦獨立執行
- **Rate Limiting**：Upstash 未設定時自動停用（fail-open），設定後立即生效
- **Sentry**：`NEXT_PUBLIC_SENTRY_DSN` 未設定時靜默，不影響系統運作
