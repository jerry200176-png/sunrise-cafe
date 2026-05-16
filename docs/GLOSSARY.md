# 術語表 / Glossary

AI 在理解業務邏輯時容易卡關的名詞定義。

---

## 業務術語

| 術語 | 說明 |
|------|------|
| **包廂** | 昇昇咖啡的可預約空間，有小包廂（2-4人）與會議室（8-12人）等型別 |
| **訂金** | 預約時需繳納的訂位保證金，通常為總金額的一半 |
| **末五碼** | 匯款後的銀行轉帳末五碼，客人傳給 Bot 作為付款確認 |
| **大安店** | 目前主要營運分店，代號用於篩選 Cron Job 推播範圍 |
| **喵喵哥** | 無訂位時群組自動發送的貓咪訊息，為業主自訂的趣味設計 |

## 訂位狀態（`reservations.status`）

| 值 | 說明 |
|----|------|
| `pending` | 客人送出訂位，待後台確認 |
| `confirmed` | 後台已確認，訂金請求已發送給客人 |
| `cancelled` | 訂位已取消 |

## 系統模組

| 名稱 | 說明 |
|------|------|
| **群組 Bot** | 推播明日提醒、付款通知到 LINE 群組的官方帳號 |
| **客人 Bot** | 與客人 1 對 1 互動（訂金請求、付款確認回覆）的官方帳號 |
| **print-bridge** | 店內電腦執行的本機服務，接收廚房列印請求並轉發給熱感印表機 |
| **Cron Job** | Vercel 每日自動執行的排程任務（台灣時間 20:00 推播提醒） |
| **Webhook** | LINE 平台在客人傳訊息後主動呼叫的 API 端點（`/api/webhooks/line`） |

## 程式碼慣例

| 慣例 | 說明 |
|------|------|
| `supabase-admin.ts` | 使用 service role key 的後端操作，不可在前端引用 |
| `supabase-fetch.ts` | 使用 anon key 的前端操作 |
| `line-notify.ts` | 群組通知（`LINE_CHANNEL_ACCESS_TOKEN`） |
| `line.ts` | 客人個人通知（`LINE_CUSTOMER_ACCESS_TOKEN`） |
| `migration-*.sql` | 資料庫 schema 異動，需手動到 Supabase SQL Editor 執行 |
