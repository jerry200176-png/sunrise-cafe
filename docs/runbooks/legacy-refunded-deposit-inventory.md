# 盤點舊資料「訂金已退」（Founder A6-5）

**目的：** 舊資料裡 `reservations.deposit_status = 'refunded'` 的訂位有多少、金額多少，以及能不能判斷是部分還是全額退款。
**不假設全部是全額退款。** 舊的 Stripe `charge.refunded` webhook 不管部分或全額都會標 `refunded`，所以只能把它們當成「未知」，直到逐筆核對。

在 Founder 決定前，新程式對這些列採取最保守的做法：
- 系統退款與系統外退款補登都會擋下（`nothing_to_refund`、`legacy_refund_status_unverified`）。
- 結帳時不折抵訂金。

## 誰、在哪裡跑

- **只能由 Founder（或 Founder 指定的人）** 在 Supabase SQL Editor 執行。也可以在本機用唯讀連線執行。
- **不要**在 CI、雲端 agent session 執行，也**不要**用會寫入的帳號。
- 查詢：[`supabase/queries/legacy-refunded-deposit-inventory.sql`](../../supabase/queries/legacy-refunded-deposit-inventory.sql)
  - 整段是 `BEGIN TRANSACTION READ ONLY … ROLLBACK`，不會寫任何資料。
  - 只用到 `reservations`、`payment_intents`、`ops_events` 三張既有的表，套用 #444 migration 之前或之後都能跑。

## 步驟

1. 開 Supabase SQL Editor，貼上整份查詢並執行。會得到三個結果：
   1. **總數**：`legacy_refunded_rows`（筆數）、`deposit_gross_estimate_total`（訂金估計總額，整數元）、`rows_without_total_price`（沒有訂位總價、算不出訂金的筆數）。
   2. **分組**：依 `evidence` 與 `partial_or_full` 分組的筆數與金額。
   3. **明細**：只有 ID、訂位代號、金額與 Stripe 編號，**不含**姓名、電話。
2. 把三個結果存成 CSV。這份 CSV 不要貼到 GitHub：repo 是公開的。
3. 依 `evidence` 逐筆核對：

| evidence | 意思 | 怎麼核對 |
|---|---|---|
| `api_full_refund_logged` | 舊退款 API 留下的紀錄（那支 API 只會全額退），有 Stripe 退款編號 `stripe_refund_ids` | Stripe 後台 → Refunds → 搜尋該編號，看金額是否等於訂金 |
| `webhook_refund_only` | 只有 Stripe 回報的 `charge.refunded`，可能是後台部分退款 | Stripe 後台 → Payments → 搜尋 `payment_intent_id`，看 Charge 的 `amount_refunded` |
| `stripe_pi_no_log` | 有 Stripe 付款，但系統沒有退款紀錄 | 同上，查 `payment_intent_id` |
| `no_stripe_payment` | 訂金不是經 Stripe 付的（轉帳、現金） | 只能人工核對銀行轉帳紀錄或現金收據 |

`pi_amount_raw` 是舊表原樣的金額。舊程式有 TWD ×100 的單位問題，見 `docs/plans/2026-10-15-refund-rollback.md` §2a，所以只拿來對照，不要直接當成金額。

## 核對後要 Founder 決定的事

- 核對結果確認是**全額**的列：維持現狀（系統當作全額已退）。
- 核對結果是**部分**退款的列：要不要補登帳本？補登要用一個新的、經 Founder 核准的一次性程序，**不是**這個查詢。這個查詢絕不寫資料。
- 無法核對的列：維持擋下。也就是不能系統退款、不能補登、結帳不折抵訂金。

## 已在本機驗證

`scripts/test-settlement-sql.sh` 在拋棄式 PostgreSQL 上用測試資料跑過這份查詢：
- 四種 `evidence` 都能分出來。
- 金額加總正確。
- 沒有 `total_price` 的列另外計數。
- 查詢在 READ ONLY transaction 裡、最後 ROLLBACK（測試會確認跑完後沒有多出任何物件或資料）。
