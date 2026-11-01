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
| **喵喵哥** | 群組機器人的貓咪趣味訊息；為節省訊息配額，空檔不再自動推送 |

## 訂位狀態（`reservations.status`）

資料庫只允許這五種（`reserved`、`rejected` 等其他值是 bug，不存在）。

| 值 | 說明 |
|----|------|
| `pending` | 客人送出訂位，待後台確認 |
| `confirmed` | 後台已確認，訂金請求已發送給客人 |
| `checked_in` | 客人已到店 |
| `completed` | 已結帳完成（會鎖定預點餐、發送評論邀請） |
| `cancelled` | 訂位已取消；只能用後台「還原」離開此狀態 |

可轉換的狀態由 `transitionReservation` 的轉換表決定（後台 PATCH 不能任意設定狀態）：

| 從 | 可做的操作 |
|----|-----------|
| `pending` | 確認、到店、完成、取消 |
| `confirmed` | 到店、完成、取消 |
| `checked_in` | 完成、取消 |
| `completed` | 無 |
| `cancelled` | 還原（回到 `pending`；已付訂金則回 `confirmed`；原時段須仍空閒） |

客人自助：只有 `pending`／`confirmed` 可取消或改期；已付訂金不可自助取消（走退訂申請）；預約前 24 小時內不可自助取消或改期。伺服器以 `allowed_actions[]` 告知查詢頁可做什麼。

## 系統模組

| 名稱 | 說明 |
|------|------|
| **群組 Bot** | 推播明日提醒、付款通知到 LINE 群組的官方帳號 |
| **客人 Bot** | 與客人 1 對 1 互動（訂金請求、付款確認回覆）的官方帳號 |
| **print-bridge** | 店內電腦執行的本機服務，接收廚房列印請求並轉發給熱感印表機 |
| **Cron Job** | Vercel 每日自動執行的排程任務（台灣時間 20:00 推播提醒） |
| **Webhook** | LINE 平台在客人傳訊息後主動呼叫的 API 端點（`/api/webhooks/line`） |

## 核心模組（深模組：小介面，規則集中在裡面）

| 模組 | 介面 | 負責 |
|------|------|------|
| `src/lib/bookable.ts` | `checkBookable(roomId, start, end, { actor, excludeId })` → ok 或原因 | 可訂時段規則：2–8 小時、營業時間、公休日、撞期；時段格子（`/api/availability`）用同一份 `resolveDay`。DB exclusion constraint（ADR-010）仍是最後防線 |
| `src/lib/reservation-lifecycle.ts` | `transitionReservation(id, intent, actor)`、`guestAllowedActions()` | 狀態轉換表、預點餐、候補釋出、該發哪張 LINE（內容不變）、評論邀請、稽核。路由只剩登入檢查與 HTTP 對應 |
| `src/lib/deposit-paid.ts` | `markDepositPaid(reservationId, source, evidence, actor)` | 所有「已付訂金」入口（後台 PATCH、付款審核、Stripe webhook／confirm-deposit）：寫入、稽核、核准通知（含重試／租約）、Stripe 付款綁定檢查。`deposit_approved_*` 追蹤欄位只由 payment-notify 寫入 |
| `src/lib/deliver-once.ts` | `deliverOnce(kind, reservationId, recipient, send)` | LINE 訊息只發一次（`line_deliveries` 表；需 migration，見 PR #421，尚未合併） |
| `getDepositAmount`（`booking-utils.ts`） | 總價 → 訂金 | 訂金金額唯一算法（總價 50%，無條件進位） |

## 程式碼慣例

| 慣例 | 說明 |
|------|------|
| `supabase-admin.ts` | 使用 service role key 的後端操作，不可在前端引用 |
| `supabase-fetch.ts` | 使用 anon key 的前端操作 |
| `line-notify.ts` | 群組通知（`LINE_CHANNEL_ACCESS_TOKEN`） |
| `line.ts` | 客人個人通知（`LINE_CUSTOMER_ACCESS_TOKEN`） |
| `migration-*.sql` | 資料庫 schema 異動，需手動到 Supabase SQL Editor 執行 |
