# Data Dictionary — 昇昇咖啡訂位系統

Phase 5 業務資料欄位定義，供資料品質檢查、BI 與未來定價優化參考。

---

## reservations（訂位）

| 欄位 | 型別 | 說明 | 品質規則 |
|------|------|------|----------|
| `id` | UUID | 主鍵 | 必填 |
| `room_id` | UUID | 包廂 FK → `rooms.id` | 必須存在於 `rooms` |
| `customer_name` | TEXT | 客人姓名 | 非空 |
| `phone` | TEXT | 台灣手機（09xxxxxxxx） | 正規化後驗證格式 |
| `email` | TEXT | 選填 Email | 可空 |
| `start_time` | TIMESTAMPTZ | 開始時間 | `end_time > start_time` |
| `end_time` | TIMESTAMPTZ | 結束時間 | 同上 |
| `status` | TEXT | `pending` / `confirmed` / `checked_in` / `cancelled` / `completed` | 取消須有 metadata |
| `total_price` | NUMERIC | 總價 | 完成態建議有值 |
| `is_deposit_paid` | BOOLEAN | 訂金已付 | 與 `payment_events` 漸進對齊 |
| `booking_code` | TEXT | 查詢碼 | 唯一 |
| `line_user_id` | TEXT | LINE 綁定 | 可空；留存/評論用 |
| `created_at` | TIMESTAMPTZ | 建立時間 | 預設 now() |
| `updated_at` | TIMESTAMPTZ | 最後更新 | Phase 5 migration |
| `cancelled_at` | TIMESTAMPTZ | 取消時間 | `status=cancelled` 時應有值 |
| `cancelled_by` | TEXT | `guest` / `admin` / `system_deposit` / `system_other` | 取消時應有值 |
| `cancellation_reason` | TEXT | 原因碼或短文字 | 建議填寫 |
| `review_invited_at` | TIMESTAMPTZ | 評論邀請已發 | 可空 |
| `deposit_reminder_sent_at` | TIMESTAMPTZ | 訂金提醒已發 | 可空 |

**分店歸屬**：透過 `room_id` → `rooms.branch_id` 推導，訂位表不冗餘 `branch_id`。

---

## branches（分店）

| 欄位 | 說明 |
|------|------|
| `name` | 內部名稱 |
| `display_name` | 對客顯示店名（繳費話術） |
| `payment_info` | 匯款資訊 |
| `line_pay_url` | LINE Pay 連結 |
| `line_group_id` | 群組 Bot 推播目標 |
| `open_time` / `close_time` | 營業時段（利用率計算） |

---

## rooms（包廂）

| 欄位 | 說明 |
|------|------|
| `branch_id` | 所屬分店 |
| `price_weekday` / `price_weekend` | 每小時定價（未來動態定價基準） |
| `capacity` | 最大人數 |

---

## analytics_events（產品分析）

| 欄位 | 說明 |
|------|------|
| `event_name` | 白名單事件名（見 `analytics-events.ts`） |
| `session_id` | 匿名工作階段 |
| `branch_id` / `room_id` | 選填維度 |
| `properties` | JSON，**禁止 PII**；可含 `experiment` / `variant` |

---

## experiments（成長實驗）

| 欄位 | 說明 |
|------|------|
| `key` | 實驗識別（cookie / analytics） |
| `status` | `draft` / `running` / `paused` / `completed` |
| `variants` | JSON 陣列，如 `["control","treatment"]` |
| `target_audience` | 受眾描述（`all` 等） |
| `start_at` / `end_at` | 實驗期間 |

---

## demand_snapshots（需求信號 — 定價準備）

每日彙整，**無 PII**，供未來 occupancy / 需求定價。

| 欄位 | 說明 |
|------|------|
| `snapshot_date` | 統計日（台北日曆） |
| `branch_id` | 分店 |
| `room_id` | 可空（分店彙總時 null） |
| `hour` | -1 = 全日；0–23 = 時段 |
| `bookings` / `booked_hours` / `revenue` | 需求指標 |
| `cancellations` / `waitlist_joins` | 取消與等位 |
| `avg_lead_time_hours` | 平均預約提前量 |
| `occupancy_rate` | 利用率 0–1 |

---

## payment_events（付款審核）

| 欄位 | 說明 |
|------|------|
| `status` | `pending_review` / `approved` / `rejected` |
| `reservation_id` | 關聯訂位 |
| LINE 截圖回報不直接改 `is_deposit_paid`，須後台審核 |

---

## 資料品質檢查（`data-quality.ts`）

| 代碼 | 嚴重度 | 說明 |
|------|--------|------|
| `invalid_time_range` | error | 結束早於開始 |
| `orphan_room` | error | room_id 不在現有包廂 |
| `invalid_phone` | warning | 電話格式異常 |
| `cancelled_missing_metadata` | warning | 取消缺 cancelled_at/by |
| `confirmed_unpaid_deposit` | info | 確認但未付訂金 |
| `cancellation_spike` | warning | 今日取消異常偏高 |
| `analytics_empty` | info | 無近期分析事件 |

---

## 隱私備註

- 留存 API 僅回傳**遮罩電話**與彙總，不提供完整 PII 匯出。
- Analytics 屬性白名單，不含姓名/電話/Email。
- 行銷推播須人工審核後由既有 LINE 流程發送。
