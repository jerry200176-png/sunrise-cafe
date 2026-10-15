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
| 10 | **現金找零（Founder D6，2026-10-15）**：`reservation_settlements` 多 5 個欄位 `cash_tendered`、`change_given`、`change_given_by`、`change_given_by_role`、`change_given_at`，加一條 CHECK：有找零就一定是「現金、有收錢、沒有退訂金」，而且 `change_given = cash_tendered − amount_collected`。`settle_reservation_checkout` 多一個參數 `p_cash_tendered`（預設 NULL）：一般員工可以記找零；非現金（`change_cash_only`）、沒收錢或要退訂金（`change_not_refund`）、付的比要收的少（`cash_tendered_short`）、超過 NT$ 100,000（`invalid_cash_tendered`）、沒有操作者（`change_actor_required`）一律擋下；表的 CHECK 也要求有找零（> 0）就一定記下是誰、什麼角色找的。找零**不進**退款帳本。**Founder A6-7**：現金、有要收的錢時「客人給了多少」必填（函式 `cash_tendered_required`＋表 CHECK）；0 元結帳與純退款不需要 | D6、A6-7 |
| 11 | **退款帳本種類改名**：`checkout_change` → `checkout_deposit_excess`（結帳時訂金比帳單多、要退的差額）。這是退款、限老闆／本分店店長，不能叫「找零」（D6：退款不可包成找零）。只改名稱，規則不變 | D6 |
| 12 | **人工退款要有證據才能標成功（Founder D7，2026-10-15）**：`reservation_refund_events` 多一欄 `evidence_ref`（轉帳序號、LINE Pay 交易編號…），並加 CHECK（審閱 P2：連 service key 直接寫入也繞不過）：每一步都要有角色；人工（非金流商）的成功／失敗／取消一定要有說明，非現金的「成功」還要有 `evidence_ref`；金流商身分只能用在 Stripe 退款，Stripe 退款除了「申請」之外只能由金流商記。事件多一欄 `refund_method`，由 BEFORE INSERT trigger 從退款那一列帶入（寫入者填的值會被蓋掉）並以外鍵 `(refund_id, refund_method)` 對應 `reservation_refunds (id, method)`。`record_reservation_refund_status` 多一個參數 `p_evidence_ref`（預設 NULL）：人工標「成功」時，非現金要有 `evidence_ref`＋說明、現金要有說明，否則 `refund_evidence_required`；標「失敗」「取消」沒寫原因 → `refund_reason_required`；人工不能寫金流商編號（`provider_outcome_only`）。結帳時現金當場退的差額，事件上自動帶說明。`reservation_refund_current` view 末端多 `evidence_ref`、`status_note` 兩欄 | D7 |
| 13 | 解除結帳的「退款處理中」**只能**經過上面這些可追查的狀態變化（確認已退／失敗／取消；Stripe 只能由 Stripe 回報或對帳）；沒有任何繞過 `refund_in_flight` 的路徑 | D7 |
| 14 | **Founder A6（2026-10-15）**：`refund_reference_valid`（證據編號格式）；事件表多 `previous_status`（trigger 帶入）、`cash_handed_back`，CHECK 改成：狀態轉換照規則、人工成功要格式正確的編號（現金要已交還）、已退改失敗要編號；退款表多 `off_system`；新表 `reservation_refund_alert_acks`；新 view `reservation_refund_alerts_with_ack`、`reservation_refund_obligations`；新函式 `record_offsystem_refund`、`acknowledge_refund_alert`、`raise_refund_alert`；`record_reservation_refund_status` 多 `p_cash_handed_back`；警示種類多 `provider_outcome_unknown`、`offsystem_refund_recorded`；結帳退訂金差額一律先 pending；`settle_reservation_checkout` 現金有收錢時要 `cash_tendered`（A6-7） | A6-1～9 |

沒有改的：延長紀錄、結帳紀錄兩張表的欄位與檢查條件、延長函式、計費規則、no_show 不佔時段的規則。

應用程式這邊（同一個 PR，含 2026-10-15 審閱修正）：
- **金額單位（審閱 P1-b）**：Stripe 把 TWD 當兩位小數幣別。所有和 Stripe 往來的金額都經過 `src/lib/stripe-money.ts`：建立付款 ×100、退款 ×100、webhook 讀回 ÷100、付款金額驗證 ÷100。原本 `create-intent` 送出 NT$500 實際只會收 NT$5（正式環境 Stripe 未啟用，是潛在問題，這次一起修）。
- **結果不明的 Stripe 退款（審閱 P1-a）**：每次重送先向 Stripe 對帳；23 小時內查不到才用同一個冪等鍵（含帳本 id）重送；超過 23 小時不再重送，Stripe 確認沒有這筆退款才記取消。新增 `PATCH { reconcile: true }`。
- webhook 遇到過期或順序錯亂的狀態（例如成功之後才到的 pending）會記 log 並回 200，不再 500。
`POST /api/payment/refund` 改成先記帳本再呼叫 Stripe（冪等鍵綁帳本編號，重送不會退兩次）、照 Stripe 回的狀態記、`finance` 角色不再能退款、可部分退款；新增 `PATCH` 讓老闆／本分店店長確認人工退款結果；Stripe webhook 改成同步每一筆退款，不再一收到 `charge.refunded` 就把整筆訂金標成已退；舊結帳流程（migration 還沒套用時）也要求老闆／本分店店長才能退差額。

## 2. 需要 Founder 決定的事

**主要決定：** 核准「`supabase/migration-reservation-settlements.sql` sha256 `41fdabdeaab7d8feb0816dc3398fa11b99ea32a4106572aafcee4edcdef6319b`」（含 D6 現金找零、D7 退款證據、A6 退款政策；#448 @ `78a4619` 的 `06dc6a71…f722` 已被取代）這一份確切內容，可以在下面的備份步驟之後套用到正式環境（#446 換成同一份）。沒有核准前，新表不存在，API 走舊流程，退款 API 會回 503（不會在沒有帳本的情況下退款）。

### 政策狀態（Founder 2026-10-15 B2／A6 回覆後）

Founder 指示「不要整包默認同意」，所以逐條標狀態。原本列 5 條，審閱時加了第 6 條。

| # | 政策 | 狀態 | 怎麼做到的 |
|---|---|---|---|
| 1 | 退款只限老闆或本分店店長；finance 不能退 | **已確認（A6-1），已實作** | SQL `can_adjust_reservation_money`＋API session 角色。finance 改成唯讀稽核：`GET /api/payment/refund`（`?view=ledger`、`?view=open`、單筆訂位）回 `viewer.can_act=false`，畫面不顯示按鈕；POST／PATCH 一律 403 |
| 2 | 舊流程結帳過的訂位，系統退款擋下 | **已確認（A6-2），已實作人工流程** | 系統退款仍擋（`nothing_to_refund`）。新增 `record_offsystem_refund`＋`POST { offSystem: true }`＋畫面「系統外退款補登」：老闆／本分店店長在人工核對、實際退款後補記。要原因＋格式正確的交易編號（現金要確認已交還）、冪等鍵，每筆都開一個需要認領的 `offsystem_refund_recorded` 警示 |
| 3 | 現金退款要真的交還、操作者確認才算完成；找零和退訂金分開記 | **已確認（A6-3），已實作** | 結帳退訂金差額**一律先記 pending**（現金也是）；確認時現金要勾「已交還」（`cash_handed_back`，函式＋事件表 CHECK），非現金要交易編號。找零只記在 `reservation_settlements.change_given`，退款只記在帳本，兩邊不合併 |
| 4 | Stripe 實際回報照實記並開警示；每個警示都要有人負責 | **已確認（A6-4），已實作** | 新表 `reservation_refund_alert_acks`（只能新增；誰、角色、說明）、函式 `acknowledge_refund_alert`（老闆／該分店店長，要說明）、view `reservation_refund_alerts_with_ack`（`acknowledged_at` 為空 = 未認領清單），`/admin/refunds` 顯示未認領清單 |
| 5 | 舊資料 `deposit_status='refunded'`（帳本沒有紀錄） | **未確認：不得假設全額（A6-5）** | 已準備唯讀盤點查詢 `supabase/queries/legacy-refunded-deposit-inventory.sql` 與 runbook `docs/runbooks/legacy-refunded-deposit-inventory.md`，由 Founder 執行。盤點前程式採最保守：結帳不折抵這些訂金、系統退款與補登都擋下（`legacy_refund_status_unverified`） |
| 6 | 結果不明的 Stripe 退款 | **已確認並修正（A6-6）** | 對帳改成完整查詢：翻完這筆付款在 Stripe 的每一頁退款，並直接查帳本上已知的退款編號。查不到又超過 23 小時（或查詢不完整）→ **不取消、不解鎖**，維持處理中、結帳仍擋，開 `provider_outcome_unknown` 警示（同一筆未認領時不重複開） |
| A6-7 | 現金結帳有要收的錢時，客人給的現金必填 | **已確認，已實作** | `cash_tendered_required`（API＋函式＋表 CHECK）。0 元結帳與純退款不需要 |
| A6-8 | 成功證據 = 可驗證的交易編號＋原因；任意文字不算 | **已確認，已實作（格式待確認）** | `refund_reference_valid`（SQL）＝ `REFUND_REFERENCE_PATTERNS`（TS，測試直接比對 migration 字串）。格式見 `docs/PAYMENT_STATE_MODEL.md`「退款證據編號格式」。截圖上傳之後再做 |
| A6-9 | 已退改失敗要有失敗／退回證據；取消申請不能讓欠款消失 | **已確認，已實作** | 已退 → 失敗要格式正確的交易編號＋原因（函式＋事件表 CHECK，`previous_status` 由 trigger 帶入）；現金交還後不能改失敗。新 view `reservation_refund_obligations`：結帳欠客人的訂金差額，直到補退**成功**才離開待辦；`POST { kind: "checkout_deposit_excess" }` 補申請 |

### 還需要 Founder 回答

1. **#5 舊資料**：跑完盤點後，核對確定是部分退款的列要怎麼處理（補登帳本需要另一個經核准的一次性程序）；無法核對的列是否維持擋下。
2. **A6-8 格式**：轉帳（6–32 碼、至少 6 個數字）、LINE Pay（19 位數字）、刷卡（授權碼 6 碼或 12 位 RRN）、其他（`管道代碼:編號`）這四個格式是否符合實際作業？要不要再加別的方式？
3. **A6-6 結果一直不明的 Stripe 退款**：系統只會維持處理中＋警示，沒有任何解鎖路徑。若人工向 Stripe 確認真的沒有這筆退款，要用什麼核准程序結案？目前刻意沒做。
4. **A6-2 補登上限**：沒有結帳紀錄的舊訂位，補登上限是「已付訂金 − 帳本上已退／處理中」，不再假設舊結帳已折抵（因為已人工核對）。可以嗎？

金額單位：已修正（見上）。Stripe 目前在正式環境沒有啟用（`create-intent` 回 503），所以舊的單位錯誤沒有實際收過錢。

## 2a. Stripe 啟用前（cutover）注意

- Stripe 目前在正式環境**沒有啟用**：`create-intent` 回 503「Stripe 支付尚未啟用」。
- 如果 Stripe 曾經在正式環境啟用過：這次修正前收的訂金只收到 **1/100**（NT$500 送成 Stripe amount 500 = NT$5）。這些付款在新的付款金額檢查會被判定「付款金額不足」，退款也會被 Stripe 實收上限限制在 NT$5。
- `create-intent` 的冪等鍵是 `reservation_<id>_deposit`：修正上線後 24 小時內同一筆訂位重試，會帶同一個冪等鍵但不同金額（×100），Stripe 會拒絕（冪等鍵參數不符）。
- **啟用 Stripe 之前**：先在 Stripe 後台查有沒有 live 模式的 TWD PaymentIntent／收款；有的話逐筆人工核對、決定補收或退款，再啟用。

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
   - **拿掉**：`settle_reservation_checkout`（新舊參數版本都拿掉）、`extend_reservation_stay`、`request_reservation_refund`、`record_reservation_refund_status`、`sync_provider_refund`、`reservation_billing_state`。
   - **保留**：`reservation_settlements`、`reservation_extensions`、`reservation_refunds`、`reservation_refund_events`、`reservation_refund_alerts`、`reservation_refund_alert_acks` 六張表與所有資料；append-only trigger 與事件表的方式／前一狀態 trigger；`reservation_refund_current`、`reservation_refund_alerts_with_ack`、`reservation_refund_obligations` view；唯讀輔助函式（含事件表 CHECK 用到的 `refund_reference_valid`、`refund_transition_allowed`）；`schema_migrations` 那一列。
   - 一併拿掉：`record_offsystem_refund`、`acknowledge_refund_alert`、`raise_refund_alert`（新舊參數版本的 `record_reservation_refund_status` 都拿掉）。
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
