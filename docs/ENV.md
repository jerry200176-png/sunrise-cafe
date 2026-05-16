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

## Cron（選填）

| 變數 | 說明 |
|------|------|
| `CRON_SECRET` | Vercel Cron 呼叫 send-line 時的驗證 token，未設定則跳過驗證 |

---

## 更新流程

1. 修改 `.env.local`（本機立即生效）
2. 至 Vercel Dashboard 更新對應變數
3. Vercel → Deployments → Redeploy 最新版本
