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
群組 Bot（LINE_CHANNEL_ACCESS_TOKEN；貓咪頭像，無 webhook）
  → 推播店員群組通知（明日提醒、新訂位、付款待確認…）

客人帳號「昇咖啡 x 大安店」（LINE_CUSTOMER_ACCESS_TOKEN + LINE_CHANNEL_SECRET）
  → Push 訂金請求、提醒給客人
  → 接收 Webhook（/api/webhooks/line，簽章用 LINE_CHANNEL_SECRET）並回覆客人
```

`LINE_CHANNEL_SECRET` 是**客人帳號**的 secret（2026-09-29 依正式設定核對），不是群組 Bot 的；換群組 Bot 不要動它。
分店可各自有群組 Bot（`LINE_EXTRA_GROUP_BOTS`）與客人帳號（`LINE_BRANCH_CUSTOMER_BOTS`），見 `docs/LINE.md`。

### 時區陷阱

Vercel 伺服器跑 UTC，顯示時間**必須**轉換：

```ts
// 正確做法
const toTaipei = (s: string) =>
  new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

// 錯誤：直接用 new Date() 或 parseISO() 不轉換
```

### Cron Job

`vercel.json` 設定 `"0 12 * * *"` = UTC 12:00 = **台灣時間 20:00**，每日自動推播明日訂位提醒到群組。Vercel Hobby **可能延遲至 20:59** 才觸發；21:00 後仍無訊息才異常。Cron 若遇「明日訂位皆已 is_notified」會推狀態句而非完全靜默。同日成功後再觸發（含 GitHub 備援）會 `duplicate_skip` 不重送；GitHub 備援若延遲跨過台北 00:00 會記錄 `schedule_window_skip` 並安全略過，不會把下一天的空查詢發成「沒訂位」。觀測：`job_runs.metadata`（trigger_source/result/sent_count/…）+ `GET /api/admin/reminders/verify`。

### 群組提醒為多分店

`/api/admin/reminders/send-line` 會對所有設定了 `line_group_id` 的分店各自推播；無任何分店設定時 fallback 到 `LINE_GROUP_ID` 環境變數（向下相容）。不再以分店名稱硬編碼篩選。

### 繳費通知話術為資料庫驅動

對客店名、匯款資訊、LINE Pay 連結存在 `branches` 表的 `display_name` / `payment_info` / `line_pay_url` 欄位，由後台「分店管理」編輯。話術產生器為 `src/lib/payment-message.ts`（後台複製按鈕與伺服器推播共用）。未設定時降級為通用話術，不含任何寫死的分店帳號。

### 付款審核（漸進式）

LINE **截圖**回報寫入 `payment_events`（`pending_review`），不自動標 `is_deposit_paid`；文字關鍵字仍暫時自動標記。後台審核：`/admin/payments`（#56）。詳見 `docs/PAYMENT_STATE_MODEL.md`、ADR-008。Migration：`supabase/migration-payment-events.sql`（含 RLS，anon 無法存取；**部署後須手動執行**）。

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

### 訂金到期自動釋放（`src/lib/deposit-deadline.ts`）

`/api/admin/reminders/deposit-deadline`（**每日 4 次** Cron：UTC 01/07/13/19 ≈ 台灣 09/15/21/隔日 03，Hobby 合規；可手動觸發）：

- 期限 = `max(建立訂位時間 +48hr, 訂位開始時間 −6hr)`，並以「訂位開始時間」封頂（見 ADR-011，2026-08-14 從舊制 `min(+24hr, 訂位開始時間)` 調整——舊制對提前多天訂位的客人反而逼他們隔天就要繳訂金，對臨時訂位又幾乎沒有繳費空間，太狠）
- 適用對象：`status IN (pending, confirmed)` 且 `is_deposit_paid = false`（見 ADR-007）
- 期限前 24 小時內且未提醒過 → 推播客人提醒一次（寫入 `deposit_reminder_sent_at`）
- 期限 ≤6 小時且已發過首次提醒 → 再推迫近提醒一次（寫入 `deposit_urgent_reminder_sent_at`）
- 超過期限仍未付訂金 → 自動將 `status` 改為 `cancelled`，通知客人與群組，並觸發等位通知

> **注意：** Vercel Hobby 禁止 `0 * * * *`（每小時）。升級 Pro 後可改回每小時。

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
- **後台驗證金鑰**：`ADMIN_PASSWORD` 為登入密碼；`SESSION_SECRET`（選填）為 session 簽章金鑰，未設定時向下相容沿用密碼。建議在 Vercel 設定獨立的 `SESSION_SECRET`，更換密碼才不會讓既有 session 失效

ExoProtocol is retired (Founder 2026-10-14). Ignore any `.exo/` tree; do not start Exo sessions, tickets or `exo push`.
Still in force: never read or write `**/.env*`, `~/.ssh/**` or `~/.aws/**`; run the repo checks (`npm test`, `npm run lint`, `npm run build`) before pushing.

## Portfolio governance overlay

Read `governance/PORTFOLIO_AGENT_CONTRACT.md` before writing. It is committed
for cloud/mobile agents and contains the company's PR, approval, production,
and Founder-approval boundaries.
