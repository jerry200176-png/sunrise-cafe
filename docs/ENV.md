# 環境變數說明

所有變數存放於 `.env.local`（本機）與 Vercel Dashboard → Settings → Environment Variables（線上）。

`.env.local` 不進 git，不可公開。

---

## Supabase

| 變數 | 說明 | 取得位置 |
|------|------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案 URL | Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端公開 key | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | 後端完整權限 key（勿暴露前端） | 同上 |

## 後台

| 變數 | 說明 |
|------|------|
| `ADMIN_PASSWORD` | 後台 `/admin` 登入密碼，建議 16 字元以上 |

## LINE — 群組 Bot

用於推播訂位提醒到 LINE 群組、驗證 Webhook 簽章。

| 變數 | 說明 | 取得位置 |
|------|------|----------|
| `LINE_CHANNEL_ACCESS_TOKEN` | 群組 Bot 的 Access Token | LINE Developers → Messaging API → Issue token |
| `LINE_CHANNEL_SECRET` | 群組 Bot 的 Channel Secret，同時用於 Webhook 簽章驗證 | LINE Developers → Basic settings |
| `LINE_GROUP_ID` | 目標 LINE 群組 ID（格式：`C` 開頭 32 碼） | 透過 `/api/admin/diagnose-line` 或 Webhook log 取得 |

> 換群組 Bot 時，需同步在新 channel 設定 Webhook URL：`https://sunrise-cafe-six.vercel.app/api/webhooks/line`

## LINE — 客人 Bot

用於 Push 訂金請求給客人、回覆客人付款確認。

| 變數 | 說明 | 取得位置 |
|------|------|----------|
| `LINE_CUSTOMER_ACCESS_TOKEN` | 客人 Bot 的 Access Token | LINE Developers → Messaging API |

## LINE — Login

用於訂位表單的 LINE OAuth 登入，讓系統取得客人 LINE User ID。

| 變數 | 說明 | 取得位置 |
|------|------|----------|
| `LINE_LOGIN_CHANNEL_ID` | LINE Login Channel ID | LINE Developers → LINE Login |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login Channel Secret | 同上 |

## Upstash Redis（Rate Limiting）

| 變數 | 說明 | 取得位置 |
|------|------|----------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | console.upstash.com → 資料庫 → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token | 同上 |

> 未設定時 Rate Limiting 自動停用，系統照常運作。  
> 設定步驟：[console.upstash.com](https://console.upstash.com) 免費建立 Redis → 複製 REST URL 和 Token → 加入 Vercel 環境變數。

## Sentry（Error Monitoring）

| 變數 | 說明 | 取得位置 |
|------|------|----------|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry 專案 DSN（前後端共用） | sentry.io → 專案 → Settings → Client Keys |
| `SENTRY_ORG` | Sentry 組織 slug | sentry.io → 組織設定 |
| `SENTRY_PROJECT` | Sentry 專案 slug | sentry.io → 專案設定 |
| `SENTRY_AUTH_TOKEN` | Build 時上傳 source maps 用（選填） | sentry.io → Settings → Auth Tokens |

> DSN 未設定時 Sentry 靜默不啟動，不影響系統正常運作。

## Cron（選填）

| 變數 | 說明 |
|------|------|
| `CRON_SECRET` | Vercel Cron 呼叫 send-line 時的驗證 token，未設定則跳過驗證 |

## CTO Outcome Pipeline

| 變數 | 說明 | 設定位置 |
|------|------|----------|
| `CTO_OUTCOME_SECRET` | `GET /api/cto/outcomes` 的 Bearer token；`npm run cto:outcomes` 自動寫入 `OUTCOME_LOG.md` | Vercel production + GitHub Actions Secrets |

> 可與 `CRON_SECRET` 共用同一字串。Agent 用 production 憑證呼叫 API 即可同步 baseline，不需手動開儀表板。

## Gmail（Cloud Agent 掃失敗通知）

用於 `npm run gmail:scan` — 掃最近 48 小時 **Vercel / GitHub 部署失敗** 通知（非客人來信）。

| 變數 | 說明 | 設定位置 |
|------|------|----------|
| `GMAIL_USER` | Gmail 帳號（例如 `you@gmail.com`） | **Cursor Cloud** → [Environments](https://cursor.com/dashboard/cloud-agents/environments/r/github.com/jerry200176-png/sunrise-cafe) → Secrets |
| `GMAIL_APP_PASSWORD` | Google **應用程式密碼**（16 碼，不是登入密碼） | 同上 |

### 申請應用程式密碼（約 2 分鐘）

1. Google 帳號須開啟 [兩步驟驗證](https://myaccount.google.com/security)
2. 前往 [應用程式密碼](https://myaccount.google.com/apppasswords) → 選「郵件」→ 產生
3. 複製 16 碼密碼 → 貼到 Cursor Secrets 的 `GMAIL_APP_PASSWORD`
4. 在 Agent 對話說「掃 Gmail」→ 會跑 `npm run gmail:scan` 並回報要處理的信

> **安全：** 勿把應用程式密碼貼在 GitHub issue；只用 Cursor Secrets。若要撤銷，到 Google 刪除該組應用程式密碼即可。

---

## 更新流程

1. 修改 `.env.local`（本機立即生效）
2. 至 Vercel Dashboard 更新對應變數
3. Vercel → Deployments → Redeploy 最新版本
