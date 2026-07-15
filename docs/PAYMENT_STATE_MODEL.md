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
