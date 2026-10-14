# #444 退款原則：SQL 改了什麼、怎麼備份、怎麼回滾（保留資料）

> 狀態：**草稿，尚未套用到任何 Supabase 專案**。SQL：[`supabase/migration-reservation-settlements.sql`](../../supabase/migration-reservation-settlements.sql)
> 這份檔案必須和 PR #446 帶的版本**逐字相同**；#446 需要換成同一份。
> 和 Founder 先前看過的版本（#446 @ `a1962cc`，sha256 `1a0e0f0b…52ab`）相比是新的內容，**需要重新核准**。

## 1. 和先前版本相比改了什麼（白話）

先前版本只有「結帳時訂金比帳單多要退差額」，而且只記在結帳紀錄的一個數字裡；退訂金只看 `deposit_status = 'refunded'`。
這次照 Founder 的 5 條退款原則補上：

| # | 改動 | 對應原則 |
|---|------|----------|
| 1 | **新增退款帳本兩張表**：`reservation_refunds`（每筆退款一列：誰、何時、多少、原因、哪筆訂位、哪間分店、冪等鍵）和 `reservation_refund_events`（每次狀態變化一列）。兩張表都**只能新增**，trigger 擋下 UPDATE／DELETE／TRUNCATE，`service_role` 也沒有改／刪權限 | 5 |
| 2 | **新增 view `reservation_refund_current`**：每筆退款的目前狀態（最後一個事件）。`security_invoker`，anon／authenticated 讀不到 | 5 |
| 3 | **新增函式 `request_reservation_refund`**：鎖住訂位 → 冪等鍵重送就回原本那筆 → 檢查角色與分店 → 檢查最多能退多少 → 記 `requested` | 1、2、3、5 |
| 4 | **新增函式 `record_reservation_refund_status`**：記狀態變化（只允許固定的轉換）；Stripe 退款的任何結果（**包括取消**）只能由 Stripe 回報或對帳決定，店長／老闆不能動。結果不明的請求一直擋著結帳，直到 Stripe 給出答案 | 1、4、5 |
| 5 | **新增函式 `sync_provider_refund`**：Stripe webhook 回報的退款結果寫進帳本；在 Stripe 後台直接退的也補記一筆 | 4、5 |
| 5a | **新增表 `reservation_refund_alerts`（只能新增）**：Stripe 後台退款超過可退上限、在結帳已折抵訂金之後才退、或取消後 Stripe 又回報成功時，照實記帳並留一列警示，老闆／店長在 `GET /api/payment/refund` 看得到 | 1、5 |
| 5b | **新增函式 `reservation_deposit_refundable`**：訂金還能退多少的唯一算法（請求與 webhook 共用）。`request_reservation_refund` 多一個參數 `p_provider_cap`：可退金額不超過 Stripe 那筆付款實際收到、還沒退的金額 | 1、3 |
| 5c | 所有 `SECURITY DEFINER` 函式的 `search_path` 改成 `public, pg_temp`（`pg_temp` 放最後） | 安全 |
| 6 | **新增函式 `reservation_billing_state`**：結帳畫面要的數字（延長加總、訂金、真的已退、是否處理中）。API 也靠它判斷新流程是否可用 | 3、4 |
| 7 | **結帳函式 `settle_reservation_checkout` 改了 4 處**：(a) 多一個參數「操作者的分店清單」，退款與打折改成「老闆，或這間分店的店長」才行（先前只看角色、不看分店）；(b) 訂金折抵改成「已付訂金 − 真的已退的金額」（先前是看到 `deposit_status = 'refunded'` 就整筆不折抵，部分退款會算錯）；(c) 有訂金退款還在處理中就擋下結帳（`refund_in_flight`）；(d) 要退差額時，同一個 transaction 記一筆退款帳本：現金 = 已退，其他方式 = 待確認 | 1、2、3、4、5 |
| 8 | 退款成功後由 SQL 同步 `reservations.deposit_status`：實際已退 ≥ 已付訂金才改 `refunded`；之後退款失敗會改回 `paid`。這是本 migration 唯一會改既有資料列的地方，而且只在退款發生時、只動這一個欄位（現在的 Stripe 退款流程本來就寫這個欄位） | 3、4 |
| 9 | 檔尾的回滾從「DROP 全部表」改成「只拿掉函式、保留所有資料」，並拆成獨立檔案 [`supabase/rollbacks/reservation-settlements-keep-data.sql`](../../supabase/rollbacks/reservation-settlements-keep-data.sql) | 5 |

沒有改的：延長紀錄、結帳紀錄兩張表的欄位與檢查條件、延長函式、計費規則、no_show 不佔時段的規則。

應用程式這邊（同一個 PR，含 2026-10-15 審閱修正）：
- **金額單位（審閱 P1-b）**：Stripe 把 TWD 當兩位小數幣別。所有和 Stripe 往來的金額都經過 `src/lib/stripe-money.ts`：建立付款 ×100、退款 ×100、webhook 讀回 ÷100、付款金額驗證 ÷100。原本 `create-intent` 送出 NT$500 實際只會收 NT$5（正式環境 Stripe 未啟用，是潛在問題，這次一起修）。
- **結果不明的 Stripe 退款（審閱 P1-a）**：每次重送先向 Stripe 對帳；23 小時內查不到才用同一個冪等鍵（含帳本 id）重送；超過 23 小時不再重送，Stripe 確認沒有這筆退款才記取消。新增 `PATCH { reconcile: true }`。
- webhook 遇到過期或順序錯亂的狀態（例如成功之後才到的 pending）會記 log 並回 200，不再 500。
`POST /api/payment/refund` 改成先記帳本再呼叫 Stripe（冪等鍵綁帳本編號，重送不會退兩次）、照 Stripe 回的狀態記、`finance` 角色不再能退款、可部分退款；新增 `PATCH` 讓老闆／本分店店長確認人工退款結果；Stripe webhook 改成同步每一筆退款，不再一收到 `charge.refunded` 就把整筆訂金標成已退；舊結帳流程（migration 還沒套用時）也要求老闆／本分店店長才能退差額。

## 2. 需要 Founder 決定的事

**主要決定：** 核准「`supabase/migration-reservation-settlements.sql` sha256 `674894e6b0552c9b23bbe4106d8d53f4a8c1348fdb50ceb8ebe2564193ed80e4`」這一份確切內容，可以在下面的備份步驟之後套用到正式環境（#446 換成同一份）。沒有核准前，新表不存在，API 走舊流程，退款 API 會回 503（不會在沒有帳本的情況下退款）。

一起確認的政策（都已照推薦寫進程式）：

1. **`finance` 角色不能再退款**（原則 2 只列老闆和店長）。推薦：照原則。
2. **舊流程結帳過的訂位（已完成、沒有結帳紀錄）不能從系統退訂金**：系統無法知道訂金是否已在舊結帳折抵，所以一律當作已折抵。真的要退就由老闆在 Stripe 後台處理，webhook 會補記。推薦：照做。
3. **結帳退差額用現金以外的方式（轉帳、LINE Pay…）先記「待確認」**，要老闆／店長確認後才算已退（目前只有 API，沒有畫面；畫面另開 issue）。推薦：照做。
4. **在 Stripe 後台直接退的款**，webhook 照實補記（錢已經動了），紀錄上標成 `provider`；超過上限或在結帳折抵之後才退的，另外留警示給老闆／店長處理。推薦：照做。
6. **結果不明的 Stripe 退款不能由店長取消**：只能等 Stripe 回報或按「對帳」；這段期間這組不能結帳。推薦：照做（否則訂金可能被退一次又折抵一次）。
5. **舊資料 `deposit_status = 'refunded'`（帳本沒有紀錄）一律當作全額已退**（舊的退款 API 只能全額退）。推薦：照做。

金額單位：已修正（見上）。Stripe 目前在正式環境沒有啟用（`create-intent` 回 503），所以舊的單位錯誤沒有實際收過錢。

## 3. 套用前備份（必做）

1. 用 `scripts/backup-db.sh` 做一份完整備份（需要 `SUPABASE_DB_URL`，由 Founder／有權限的人在本機執行，**不要**在 CI 或雲端 session 執行）：
   ```bash
   bash scripts/backup-db.sh ./backups
   ```
   確認產生的 `.sql`、`.sha256`、`.manifest.json` 三個檔案都在，檔案大小合理。
2. 另外匯出這次會碰到的表（小、方便對照）：
   ```sql
   -- Supabase SQL Editor，結果存成 CSV
   SELECT id, status, is_deposit_paid, deposit_status, total_price FROM reservations WHERE is_deposit_paid;
   ```
3. 記下套用前的檢查（migration 檔頭兩個查詢）結果。

## 4. 套用步驟（Founder GO 之後）

1. 完成上面的備份。
2. Supabase SQL Editor 執行整份 `migration-reservation-settlements.sql`（`BEGIN/COMMIT`，失敗整份不生效）。
3. 驗證：
   ```sql
   SELECT version FROM schema_migrations WHERE version = '20261014-reservation-settlements';      -- 1 列
   SELECT count(*) FROM reservation_refunds;                                                      -- 0
   SELECT proname FROM pg_proc WHERE proname IN ('settle_reservation_checkout','request_reservation_refund',
     'record_reservation_refund_status','sync_provider_refund','reservation_billing_state');      -- 5 列
   SET ROLE anon; SELECT 1 FROM reservation_refunds; RESET ROLE;                                  -- 要被拒絕
   ```
4. 之後才合併 #447（API 改用新函式）。

## 5. 回滾（保留資料）

原則：**不刪任何結帳、延長、退款紀錄**。回滾只讓系統回到舊流程，紀錄留著供對帳。

### 5.1 只回滾程式（優先）

`vercel rollback` 到前一版，或 revert #447 的 merge commit。資料庫不動。新表留著、函式留著也沒關係（舊程式不會呼叫）。

### 5.2 回滾資料庫函式（程式回滾後仍有問題時）

1. 先照第 3 節再備份一次（這時已經有結帳／退款紀錄）。
2. 執行 [`supabase/rollbacks/reservation-settlements-keep-data.sql`](../../supabase/rollbacks/reservation-settlements-keep-data.sql)：
   - **拿掉**：`settle_reservation_checkout`、`extend_reservation_stay`、`request_reservation_refund`、`record_reservation_refund_status`、`sync_provider_refund`、`reservation_billing_state`。
   - **保留**：`reservation_settlements`、`reservation_extensions`、`reservation_refunds`、`reservation_refund_events`、`reservation_refund_alerts` 五張表與所有資料；append-only trigger；`reservation_refund_current` view；唯讀輔助函式；`schema_migrations` 那一列。
   - no_show 不佔時段的規則：沒有重疊才換回舊規則；有重疊就保留新規則（不然舊規則建不回來）。
3. 回滾後程式的行為（#447 的程式碼即使還在也安全）：
   - API 偵測到 `reservation_billing_state` 不存在 → 結帳、延長走舊流程。
   - 舊流程結帳仍會讀保留下來的退款帳本：只扣實際已退的訂金、退款處理中就擋結帳、退差額仍限老闆／本分店店長。
   - 退款 API 會回 503（沒有帳本函式就不退款）。要退款請在 Stripe 後台處理，事後再補記。
   - 回滾期間在 Stripe 後台退的款只會在 `charge.refunded` 全額時把 `deposit_status` 標成 `refunded`；重新套用 migration 後，下一次 webhook 會補進帳本。

### 5.3 回滾後驗證

```sql
-- 資料一列都沒少（和回滾前記下的數字比）
SELECT (SELECT count(*) FROM reservation_settlements) AS settlements,
       (SELECT count(*) FROM reservation_extensions)  AS extensions,
       (SELECT count(*) FROM reservation_refunds)     AS refunds,
       (SELECT count(*) FROM reservation_refund_events) AS refund_events,
       (SELECT count(*) FROM reservation_refund_alerts) AS refund_alerts;
-- 會寫入的函式都不在了（0 列）
SELECT proname FROM pg_proc WHERE proname IN ('settle_reservation_checkout','extend_reservation_stay',
  'request_reservation_refund','record_reservation_refund_status','sync_provider_refund','reservation_billing_state');
-- 帳本仍然只能新增（要被擋下：refund_ledger_append_only）
BEGIN; UPDATE reservation_refunds SET reason = reason; ROLLBACK;
```

再到後台結帳一組測試訂位，確認走舊流程、金額正確。

### 5.4 再往前（重新套用）

修好之後重新執行整份 migration 即可（可重複執行，本機已驗證回滾後重套成功）。

### 5.5 不做的事

不 `DROP` 這五張表、不刪 `schema_migrations` 那一列。要刪表需要 Founder 另外做資料保存決定，並先完成第 3 節的備份與匯出。

## 6. 測試（本機拋棄式 PostgreSQL 16，未碰任何 Supabase）

`bash scripts/test-settlement-sql.sh`（只允許本機連線）：

- migration 套用兩次都成功。
- `supabase/tests/refund-ledger.test.sql`：原則 1–5 各自的情境（訂金退了不再折抵、重試結帳、已折抵不能退、舊資料、角色與分店、anon 權限、部分退款、處理中／失敗／成功後失敗、Stripe 結果只能由 Stripe 回報、帳本不能改刪、冪等鍵、狀態轉換）。
- 同時操作（兩個連線搶同一筆訂位）：先退款再結帳、先結帳再退款、兩台同時結帳、兩筆全額退款、同一個冪等鍵送兩次。
- 審閱修正：結果不明的 Stripe 退款店長／老闆都不能取消、Stripe 之後回報成功仍算已退且不會被結帳折抵、取消後又成功留警示、Stripe 後台超額或結帳後退款留警示、可退金額以 Stripe 實收為上限、所有 SECURITY DEFINER 函式的 search_path 含 `pg_temp`。
- 回滾：資料列數不變（含警示表）、會寫入的函式都拿掉、帳本仍然只能新增、之後可以重新套用。
- CI：`.github/workflows/ci.yml` 新增 `settlement-sql` job（postgres:16 service container）跑同一支腳本；目前 CI 只在對 `main` 的 PR 觸發，所以要等合併進 #447 → main 時才會跑。
