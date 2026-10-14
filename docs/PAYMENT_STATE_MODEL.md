# Payment State Model

訂金付款狀態機與漸進式遷移計畫。對應 Epic #53、#56、ADR-008。

## Current State（變更前）

```
reservations.is_deposit_paid: boolean
reservations.deposit_payment_note: text | null
```

| 觸發 | 行為 |
|------|------|
| LINE 文字（關鍵字） | 直接 `is_deposit_paid = true` |
| LINE 圖片 | 直接 `is_deposit_paid = true`（高風險） |
| 後台手動 | PATCH `is_deposit_paid` |

無稽核表、無審核狀態、無 `paid_at`。

## Target State

```
                    ┌─────────────────┐
  Guest LINE/text   │ payment_events  │
  Guest LINE/image  │ status=pending  │
  Admin manual      └────────┬────────┘
                             │
                    Admin review (#56 UI)
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
        approved                      rejected
              │                             │
              ▼                             ▼
  reservations.is_deposit_paid=true   note only
  deposit_paid_at = now()
  payment_method = source
```

### `payment_events` 表

| 欄位 | 說明 |
|------|------|
| `id` | UUID |
| `reservation_id` | FK → reservations |
| `source` | `line_text` \| `line_image` \| `admin` \| `bank_csv` \| `gateway` |
| `status` | `pending_review` \| `approved` \| `rejected` |
| `raw_payload` | 原文或 `【付款截圖】` |
| `reviewed_at` / `review_note` | 審核紀錄 |
| `created_at` | 提交時間 |

### 漸進遷移階段

| Phase | 內容 | 狀態 |
|-------|------|------|
| **0** | 修 #55 deposit deadline | ✅ |
| **1a** | migration `payment_events` + 圖片 → `pending_review` | ✅ |
| **1b** | 後台待核對佇列 UI (#56) | ✅ `/admin/payments` |
| **2** | 文字關鍵字 → `pending_review`（需 booking_code+末五碼） | ✅ Phase 2 shipped |
| **3** | CSV 對帳 (#62) | ✅ MVP（`/api/admin/payments/reconcile` POST） |
| **4** | `PaymentProvider` 抽象 (#63) | 待做 |

## State Transition Rules

### `payment_events.status`

```
pending_review ──approve──▶ approved
              └──reject───▶ rejected
```

`approved` 時同步更新 reservation（單一 transaction 理想，現階段 sequential update）。

### `reservations`（過渡期）

保留 `is_deposit_paid` 作為對外查詢欄位（客人查詢頁、報表）。未來可加 `deposit_paid_at`、`payment_method`（migration 已預留於 #53）。

### 資格函式

`getPaymentSubmissionOutcome(source)` — 見 `src/lib/payment-events.ts`：

- **Phase 2（現行）：** 所有客人來源（`line_image` / `line_text` / …）一律 → `pending_review`（不動 `is_deposit_paid`）
- 舊過渡行為 `line_text` → `auto_mark_paid` **已廢止**（以程式碼為準；勿再依 ADR-002 自動標記敘述）

## 退款（#444 退款帳本，Founder 2026-10-15 原則）

SQL：`supabase/migration-reservation-settlements.sql`（**草稿，Founder 核准前不套用**）。回滾與備份：`docs/plans/2026-10-15-refund-rollback.md`。

| 原則 | 怎麼保證 |
|------|----------|
| 1. 已退的訂金不能再折抵帳單（含重試、同時操作） | 結帳、退款請求、退款狀態變化都先鎖同一筆訂位（`FOR UPDATE`）；結帳紀錄每筆訂位唯一；訂金可退 = 已付訂金 − 進行中／已成功的退款 − 已被結帳折抵的部分 |
| 2. 只有老闆或本分店店長能退 | API 只看登入 session（`moneyActor(ctx)`）；SQL `can_adjust_reservation_money` 再檢查角色與分店；店長沒有分店清單一律拒絕；`finance` 不再能退款 |
| 3. 部分退款只扣實際退的金額 | 結帳折抵 = 已付訂金 − 狀態為 `succeeded` 的訂金退款加總 |
| 4. 失敗或處理中的退款不算已退 | 只有 `succeeded` 算已退；`requested`／`pending` 期間結帳會被擋下（`refund_in_flight`）；Stripe 退款結果只能由 Stripe 回報 |
| 5. 每筆退款都有紀錄、只能新增 | `reservation_refunds`（誰、何時、多少、原因、哪筆訂位、冪等鍵）＋ `reservation_refund_events`（狀態變化）；trigger 擋 UPDATE／DELETE／TRUNCATE |

狀態：`requested → pending → succeeded | failed | canceled`；`succeeded → failed`（金流商事後回報失敗）；`canceled → succeeded | failed` 只限金流商回報。目前狀態 = 最後一個事件（view `reservation_refund_current`）。

| 入口 | 寫什麼 |
|------|--------|
| `POST /api/payment/refund` | 先記 `requested`，再呼叫 Stripe（冪等鍵綁帳本編號），照 Stripe 回的狀態記；沒有 Stripe 付款就記人工退款（要選方式） |
| `PATCH /api/payment/refund` | 老闆／本分店店長確認人工退款結果（Stripe 退款不能手動標成功） |
| `POST /api/webhooks/stripe` | `charge.refunded`／`refund.*` → `sync_provider_refund`；Stripe 後台直接退的也會補記一筆 |
| 包廂結帳退差額 | `settle_reservation_checkout` 同一個 transaction 記一筆 `checkout_change`：現金 = `succeeded`，其他方式 = `pending` |

`reservations.deposit_status` 只在「實際已退 ≥ 已付訂金」時才改成 `refunded`（退款失敗會改回 `paid`）。舊資料：帳本沒有紀錄但 `deposit_status = refunded` 視為全額已退。

## Routes Impact

| 路徑 | 變更 |
|------|------|
| `POST /api/webhooks/line` | 圖片分支改寫入 event |
| `GET /api/admin/payments/pending` | 待審核列表 (#56) |
| `POST /api/admin/payments/:id/approve` | 核准並標記已付 |
| `POST /api/admin/payments/:id/reject` | 駁回並記錄原因 |
| `GET /api/my-bookings` | 回傳分店 `payment_info` / `line_pay_url` (#57) |
| `PATCH /api/reservations/[id]` | 不變；手動標記仍有效 |
| 新增 `GET/POST /api/admin/payments/*` | #56 |

## Production Deployment

**順序（不可顛倒）：**

1. Supabase SQL Editor 執行 `supabase/migration-payment-events.sql`
2. 驗證：`SELECT 1 FROM payment_events LIMIT 0;`（應成功）
3. 驗證 RLS：`SET ROLE anon; SELECT 1 FROM payment_events;`（應被拒絕；執行後 `RESET ROLE`）
4. Push code → Vercel 自動 deploy
5. 手動驗證：測試訂位傳截圖 → `payment_events` 有 `pending_review` 列、`is_deposit_paid` 仍 false

若先 deploy code 再跑 migration：截圖不會誤標已付（fail-safe），但客人會收到「系統暫時無法記錄」。

## Rollback

`payment_events` 為 **append-only 稽核資料**，正常 rollback **不刪除**此表。

| 情境 | 建議操作 |
|------|----------|
| 應用程式行為回退 | `vercel rollback` 或 revert webhook / deadline 相關 commit |
| 稽核資料 | **保留** `payment_events` 表與既有列，供事後對帳 |
| 僅停用新審核流程 | Revert Commit 2（webhook）；表可留空或累積歷史 |

**不建議** 在 production 執行 `DROP TABLE payment_events`，除非經明確資料治理決策且已匯出備份。

## Tests

- `deposit-deadline-eligibility.test.ts` — Cron 資格
- `payment-events.test.ts` — outcome 規則
- 未來：webhook integration test with mocked Supabase
