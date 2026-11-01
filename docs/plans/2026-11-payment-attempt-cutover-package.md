# #437／#506：付款與自動取消的分階段實施包（draft）

本文件記錄設計與阻擋，**不是已完成的付款政策、正式 migration 或上線授權**。#536 的隔離 PostgreSQL 測試只驗證合成契約，尚未執行實際 application RPC、Stripe／LINE Pay 或正式 schema。現有 ADR-012 自動取消預設關閉；不要因本文件變更該開關。

## 結論與可獨立審查的縮險項目

不能安全地只新增 attempt 表後切換 cron：舊版已可能先呼叫 provider、後寫 ledger；在途請求可能不存在於任何本地表，且舊／新部署可同時寫入。把「本地查無 attempt」當成安全取消或重新收款，可能遺失已收款證據。以下候選僅降低局部未知，**不解決完整競態，也不保證事件永久保留**：

- `payment_intent.succeeded` 的已驗簽 Stripe webhook 先驗證 binding／實收額，驗證不通過、既有 ledger 更新回傳 DB error 或記帳拋例外時回非 2xx 供 Stripe 重送，而不是吞掉例外後回 200。此 handler 新增的錯誤回應與固定訊息不包含 DB error 原文；不新增儲存欄位、不自行退款、不修改取消政策。
- 這僅適用**被新版 handler 收到且可觀察到的錯誤**。成功事件更新零列現在以 exact count 擋下，但這不涵蓋其他寫入或先前 binding 與更新之間的競態；binding 拒絕、無 reservation metadata、處理其他 event type、舊部署、已被吞掉的歷史事件均未由此候選修好。Stripe 重送有期限；DB 若已部分成功而回應遺失，重送也可能再次進入通知／audit，現有流程不能宣稱完整冪等。上線前須獨立複核現有通知 lease、並行重送與錯誤告警；無法接受或驗證重複副作用時不要部署。此候選不等於 durable inbox。
- 若需要完整證據保全，先實作並測試具唯一 event identity 的 durable inbox／對帳能力，只有可信證據已持久化、可重複安全處理後才 ack；當 DB 無法保存時回非 2xx 並發出不含付款資料的監測。Stripe 的 2xx 並不保證內部後續處理完成，重送也不是永久保存方案。

## 已重現的阻擋（synthetic RED；禁止部署此候選）

以下 9 項是要維持啟用的安全斷言，皆以合成資料／mock 重現；其中 1、3、4、5、9 的狹窄合成場景現已通過，其餘 4 項仍失敗；全部斷言不能 `skip`、刪除或降低：

1. **成功事件 ledger 零列仍 ack／入帳**：此 draft 要求 exact count 為 1，0、null 或非 1 時不呼叫 paid 並回非 2xx；這不保全事件，count 是更新後取得，若資料有重複列可能已改多筆，並無法保證 binding 查詢與更新間不變。需要 DB 唯一性、共同交易、durable inbox 與綁定核對。
2. **遲到 succeeded 覆寫 refunded ledger**：可能使退款狀態倒轉；需事件去重、交易內鎖定並以退款歷史推導不可倒退狀態。
3. **payment_failed 寫入 DB error 仍 ack**：此特定 DB error 改回非 2xx；失敗證據仍可能只剩 provider 的有限期重送，需 durable inbox 與失敗可恢復處置。
4. **expanded refund object 未處理仍 ack**：此特定場景現在回非 2xx；仍未處理 expanded ID、綁定驗證或持久化事件。
5. **refund 的兩次 DB 寫入皆失敗仍 ack**：目前可觀察的 DB error 回非 2xx；兩次寫入仍非原子，需交易化與持久、可重試證據。
6. **並行 paid 寫入重複 audit**：兩筆都看到 unpaid；需同 reservation transaction 與穩定 audit/outbox key。兩次 notify 函式呼叫不證明真 LINE 重複。
7. **refund 後 late success 影響 checkout**：合成應收由 NT$400 錯變 NT$200；需保持退款不變式並核對真 settlement RPC。此項未接觸真實結帳。
8. **confirm-deposit 可將 refunded 改回 paid**：需要和 webhook 共用資料庫層原子狀態與事件契約，不能各自先讀再寫。
9. **provider 建單後 ledger insert 失敗仍回 client secret**：此特定場景回非 2xx、隱藏 client secret，本次 handler 不直接重呼叫 provider；已送出的 provider 請求仍可能無本地紀錄，其他入口或後續請求仍可重試。需 durable claim、崩潰／timeout reconciliation 與不丟證據的 response 合約，不能只改 503 就宣稱安全。

- `route.unresolved.test.ts` 原本重現 ledger 更新匹配零列但 `error=null` 時仍回 200 並呼叫 paid；此 draft 在該情境改回非 2xx；原本 `payment_failed` 的 DB error 和 expanded refund 未處理皆回 200；此 draft 對這兩個情境改非 2xx，但沒有 durable inbox。這些都是合成 mock，不代表正式資料已發生。
- 先前 synthetic 重現 intent binding 與金額讀取都回 DB error／null，卻因缺失金額以 0 計算而接受小額付款。此 draft 的 `deposit-binding.database.test.ts` 與 webhook 合成測試已檢查 DB error 回 503／webhook 非 2xx；仍需在拒絕／重試前安全保存付款事件證據。
- `stripe-refund-checkout.unresolved.test.ts` 使用真 `deposit-paid` 與真 `computeCheckoutBill`、合成 DB state 和 checkout route 相同的 refunded→是否抵扣映射：refund 後遲到 succeeded 使應收由 NT$400 變 NT$200。正式結帳 RPC 的 SQL 同樣以 `is_deposit_paid` 和 `deposit_status != refunded` 判斷是否扣訂金；這是可能錯誤抵扣的程式證據，不是已發生的實際收款或該 RPC 的實測。
- `deposit-concurrent.unresolved.test.ts` 的合成 barrier 使兩個呼叫讀到同一 unpaid snapshot，兩者各執行 audit；reviewer 另觀察兩次 notify 函式呼叫。通知下游 lease 未在此測試執行，因此不能把兩次呼叫宣稱為真實 LINE 重複發送。
- `stripe-confirm-refund.unresolved.test.ts` 使用真 `confirm-deposit`／`markDepositPaid` 搭配合成 DB/provider，重現 PI 仍 succeeded 而 reservation 已 refunded 時，確認端點可把它改回 paid。webhook 與 confirm 必須共用**資料庫層原子**的退款／成功狀態不變式與持久證據，不能只在一端先讀狀態；本 draft 未完成這項修復。
- `route.evidence.unresolved.test.ts` 模擬 Stripe 建單回傳後本地 intent insert 失敗，此 draft 不回 200 或 client secret，亦不在本次請求中重新呼叫 provider；資料庫回應遺失可能是已提交或未提交，兩者均維持未知。在 durable pre-claim／對帳機制完成之前，不能把這當安全收款或僅靠改 HTTP 回應宣稱保全證據。
- 真 Stripe SDK 的**合法合成簽章**搭配 malformed synthetic body，可使 JSON parser exception 含 body 片段。此 draft 將 signature catch 改為固定訊息，並以合成測試確認該 catch 不再輸出片段；不能聲稱未簽名請求即可觸發，也不能聲稱整條 webhook 都已去敏。`create-intent` 與 `confirm-deposit` 外層 catch 也改為固定訊息，合成 provider exception 不再回顯；獨立 reviewer 的 synthetic 測試另發現既有下游 payment note／通知 raw error 可能進 console，本 draft 未修復全鏈日誌。

synthetic count 的可重跑驗證：先確保可信本機 Docker 上已有 `postgres:17-alpine`、`postgrest/postgrest:v12.2.12`、`node:22-alpine`，執行 `python3 scripts/research/stripe-update-count/run.py "$(realpath node_modules)"`。此研究只使用合成帳號和資料、tmpfs PG，以及共用 PG `--network none` 的本機容器網路命名空間；不拉取映像、不碰正式資料。它驗證真 supabase-js/PostgREST 回傳 exact count 0／1／2；handler 使用 mock 的測試是分開執行，這不是 app 與真 DB 的端到端或原子交易測試。Docker daemon、映像及被掛入的 node_modules 均須可信。

這些安全期待目前以測試形式保留，未達成的項目保持 RED；不得刪除、降低或繞過它們以通過 CI。最小完整修法至少要先有持久事件 inbox／同事件去重，再以交易化的 monotonic payment/refund 狀態與 reservation lock 驗證 binding、金額、已退款及 late-success；對讀取未知、零列、partial refund、expanded object 和無法綁定事件保留證據及可恢復狀態，最後才評估 ack 和重送。只把 DB error 改成 500 無法提供這些保證。

此 draft 的局部 binding 縮險已讓 DB lookup 失敗／缺資料、無效 total 回 503；已確認的 metadata/ledger 不符回 403，錯誤貨幣、非成功 PI 或不足的實收回 409。Webhook 在沒有 durable inbox 時對 binding 非 ok 回非 2xx，前端 confirm endpoint 保留上述狀態區別。此修正不代表最終可重送的事件證據已永久保存，也不處理上述退款倒轉及其他 writer。

Stripe TWD 的收款 API 使用最小貨幣單位；若訂位 `total_price` 是網站顯示的台幣元，半額 NT$500 應以 `amount=50000` 傳給 Stripe。既有 create-intent 將 config 的 500 原樣傳給 Stripe；畫面顯示的元與 provider amount 存在 100 倍單位風險。daan 的 `stripeEnabled:false` 僅反映程式配置，不證明正式 runtime、直呼 API 或歷史交易狀態。

draft 的建單候選改從 reservation→room 取得 authoritative branch，要求與 caller 一致，未設定或停用分店一律拒絕；只在現有 50% 訂金與固定分店設定相符時把 API 的台幣元轉為 Stripe minor units。`BRANCH_DEPOSIT_CONFIG` 目前使用 `daan` 字串而 DB branch id 是 UUID，未知 mapping 安全停止；不同於固定設定的有效訂金也會停止，不代表一般付款可用。此 draft 的 create-intent 與 confirm-deposit 在 provider 前要求 guest token 或電話加訂位代號並以現有 guest lookup 限流；分店判斷本身仍不是授權，不得把 reservation UUID 當授權證明。production 若 token 簽章退回共用模組已知的開發預設 secret，付款端拒絕該 token；電話及代號仍按既有驗證處理。這不證明其他設定密鑰強度、現有 guest auth 完整安全或正式設定狀態。舊版前端不帶憑證將無法使用新版 API，必須驗證前後版本混跑、token 過期及 credentials fallback；尚未聲稱可直接切換。舊版與候選使用同一 reservation idempotency key 但 amount 由 500 變 50000，同 key／不同參數可能被 Stripe 拒絕；key 到期後再呼叫又可能建立新 intent，兩者都不可視為安全 reconciliation。必須另行核對 UUID→設定映射、guest 授權切換相容性、真實已發 intent／client secret、歷史金額單位、來源綁定與新舊版混跑，並完成 durable claim/inbox 和退款狀態交易，否則嚴禁部署／開啟 Stripe。

付款 modal 在建單結果不明或完成後確認逾時時不再提供會再次建單的「重試」按鈕，提示勿重複付款並聯繫店家；這只是避免該畫面觸發二次建單，重新載入、其他入口與重複的 provider 請求仍需 durable claim 和對帳機制保護，不能視為完整修復。

## 寫入者與順序盤點（以 main 11f6d03 程式為基準，並非現場資料）

| 路徑 | 現有行為／需接入的共同契約 | 缺口 |
| --- | --- | --- |
| `src/app/api/payment/create-intent/route.ts` | 檢查 reservation → Stripe `paymentIntents.create`（固定 reservation idempotency key）→ 插入 `payment_intents` → 更新 reservation | provider 呼叫在本地 ledger 前；此 draft 對 insert error 不回 client secret；資料庫 timeout／process crash 時本地仍無法證明沒送出請求，缺少 durable pre-claim／對帳。 |
| `src/app/api/webhooks/stripe/route.ts` | main 原順序：驗簽 → 更新 intent status → binding → `markDepositPaid`；本 draft 將 binding 前移，未核實先回非 2xx | 成功事件零列以 exact count 擋下；其餘零列、binding 與更新競態、其他事件與 durable 證據保全仍未完成。event 亂序、重複、退款及舊 deployment 必須納入。 |
| `src/app/api/payment/confirm-deposit/route.ts`、`src/lib/deposit-paid.ts` | provider retrieve/binding 後，`markDepositPaid` 先 load 再無條件 update，之後 audit／通知 | 可能與 cancel 互相穿插；update 與 audit／通知不在同一 transaction。DB read error 在部分 binding 查詢中被當缺資料，不能據此推定付款不存在。 |
| `src/app/api/payment/refund/route.ts`、Stripe `charge.refunded` webhook | provider refund 與本地 `payment_intents`／`deposit_status` 分開更新 | 退款結果 unknown、重送／重試與部分退款需保留 provider id、金額、貨幣及原狀態；不得以此 PR 自動退款或改付款規則。 |
| `src/app/api/linepay/request/route.ts`、`src/lib/line-pay.ts` | 驗客戶／訂位 → 產生 orderId → LINE Pay v4 request → 收到 response 後才 insert `line_pay_payments` | timeout/crash/insert failure 可能沒有本地 row 或 transactionId；隨機重新產生 orderId 不等於安全重試。 |
| `src/app/api/linepay/confirm/route.ts`、`cancel`、`status`、`src/lib/linepay-lifecycle.ts` | 狀態查詢／confirm claim／provider confirm／`finalize_line_pay_payment`；部分 unknown 標記的 DB update 未檢查錯誤 | 需保留原始 order／transaction identity、事件結果及無法確認的狀態；未持久化 unknown 時不能宣稱已安全對帳。 |
| `supabase/migration-line-pay-safety.sql` 的 `finalize_line_pay_payment` | 先鎖 `line_pay_payments`，後更新 reservation，並寫 LINE outbox | 若其他新路徑先鎖 reservation 再鎖 payment，會形成反向鎖序；必須以新版 RPC 和雙 session 實測遷移，不能原地改已發布 SQL。 |
| `src/lib/payment-events-admin.ts`、`supabase/migration-bank-transfer-reports.sql` | `record_bank_transfer_report` 先鎖 reservation 再 event；`confirm_bank_transfer_payment` 先鎖 event 再 reservation；其他付款審核先更新 event 再獨立 `markDepositPaid` | 現有鎖序不一致，且銀行匯款／人工證據可能在取消後才到；不得把 pending review、已收款或未知一律視為沒有付款。 |
| `src/app/api/reservations/[id]/route.ts`、`src/lib/reservation-lifecycle.ts`、#506 draft | 手動付／未付、狀態變更、恢復與到店；#506 增 reservation snapshot CAS | 一般 `markDepositPaid`、直接寫入、其他 RPC 仍可繞過 CAS；到店不等於付款，NULL/false 仍須區分。 |
| `src/app/api/admin/reminders/deposit-deadline/route.ts` | 當開關啟用時，先 claim LINE delivery，再 transition cancel，後續通知／候補另做 | 需使 cancellation 與付款 attempt／audit／release outbox 原子協調；loser 不得留下誤送的 claim，DB 失敗不得發送已取消通知。 |
| `supabase/migration-booking-meals.sql`、`migration-reservation-preorder.sql`、`migration-reservation-settlements.sql`；`src/lib/supabase-admin.ts` | 預點單、結帳、延長與 generic reservation update/delete 可改相關狀態或紀錄 | 逐一核對鎖序與所有呼叫者；現有 payment 表可能有 `ON DELETE CASCADE`，刪訂位可能連帶刪付款資料；不能用 cascade 當事件留存方案。 |

## 設計候選：先確保事件可追溯，再改狀態

以下是待實作 API／資料契約，並非可直接執行的 SQL。由新版本化 additive migration 引入私有 service-only tables/RPC，明確 RLS／GRANT、索引及 retention；不得修改已發布 SQL 或假定現有兩份 `migration-payment-intents.sql` 與 `migration-stripe-payment-intents.sql` 的實際 constraint 相同。上線前對目標 schema 只讀核對；新型態、外部服務與保留／身分／付款政策依既有 F1/F4 與平台 gate 審核。

1. `payment_attempt`: stable 隨機 attempt id、reservation id、provider/account/environment、reservation version、金額／貨幣、穩定非個資 idempotency key／LINE orderId、provider id（可為 null）、狀態、建立／最後查詢時間與明確來源。必須同 transaction 先鎖 reservation，確認現狀再建立 claim；對同一 provider／attempt 的 duplicate 只能回傳既有 attempt，不能在 unknown 時產生新 provider call。可見狀態至少 `creating,pending,confirming,unknown,succeeded,failed,cancelled,reconciliation_required`；terminal、retry、timeout 與 TTL 必須依 provider 官方契約及核定政策定義，未知永不僅憑本地時間轉為失敗。LINE `transactionId` 保存精確文字，不以 JS unsafe integer 轉換。
2. `provider_event_inbox`: `(provider, account, environment, provider_event_id)` 唯一；保存可供對帳之最小欄位（provider object/order/transaction identity、事件類型、金額／貨幣、驗簽結果、provider 時間、接收時間、處理狀態與失敗原因），不可因 reservation 不存在或取消而丟棄。不能盲存含機密或個資的完整 payload；若必須保存原始簽章資料，另先核定加密、存取及保留政策。碰到同 event id 但內容／account／reservation 不一致，保留衝突供對帳，絕不視為已處理成功。
3. 版本化 `claim_attempt`、`apply_provider_result`、`cancel_overdue`、`check_in` 等 RPC 在**同一 transaction**先鎖 reservation 再依固定順序鎖 attempt／payment event；事件表與 audit／outbox 與狀態變更原子提交。舊的 event-first／payment-first RPC、直接寫入與 generic update 必須逐一導向新契約或受 DB 層保護，不能只改一個 API。成功已收款但 reservation 先取消或綁定異常時，durably 保存 provider 證據、標示 `reconciliation_required`；不能靜默標記 paid、視作失敗、重扣或自動退款。
4. `transactional_outbox`: 以穩定 event id／類型約束一筆待投遞，狀態與 audit 在同一交易；外部發送在 commit 後並遵守既有去重、租約及失敗恢復。網路重試不等於對外 exactly-once；對 provider 呼叫不得持有跨網路的 DB row lock。
5. 銀行轉帳與人工審核不是 provider callback：保留原有審核權限、金額核對及取消後異常證據；若付款先發生但報告較晚，系統不能憑無報告推定銀行未入帳。退款／安排座位由既有經授權政策決定，不由本研究創造政策。

## 版本相容與切換次序

1. 設計階段先用 #536 合成兩 session 研究與 production-like PG17/PostgREST schema 建立 RED 測試；另以 fake Stripe/LINE sandbox 驗證 API 失敗、逾時、資料庫回應遺失、整個 process 中斷和 caller retry，不能觸真付款。
2. 獨立部署 additive、預設停用的新 schema/RPC 與受控事件接收能力，確保舊 app 不會把新狀態誤認失敗；杜絕不受控 `ON DELETE CASCADE` 清除必要 provider evidence。任何 migration、權限或保留策略仍依 F1/F4/gate 決定，不從此文件推定獲准。
3. 先切全部 webhook／confirm／人工審核等證據**接收**路徑到可持久化的新契約，允許既有 provider callback 持續到達；對無法綁定 legacy payment 的事件建立受權待核對記錄，而非丟棄或造假 backfill。避免因部署版本重疊讓舊 writer 繞過同一鎖序；需以受審的 DB 約束／切換協調及 exact runtime SHA 證明，而不是只看新程式已部署。
4. 僅以有可核驗來源的現有 ledger／provider event 建立對應；對無 transactionId、缺 row、timeout 或外部轉帳未確認者維持 unknown。明確處理 Stripe 既有 key、LINE orderId 和已發出去的 client secret／payment URL；清點無法證明已結束的 legacy in-flight，必要時暫停**新建立付款與自動取消**、保持 callback/inbox 接收，等待或由授權人員對帳。若無法證明舊 writer 已退出或 in-flight 已處理，不能開啟新 auto-cancel。
5. 所有 entrypoints 遵守契約、兼容測試通過且遲到付款處理政策與回復點已確認後，才評估最終 cutover；預設維持既有「不自動取消」行為。rollback 先停新 claim／自動取消但保留 provider callback、inbox/outbox 和所有證據，回復前確認新舊 writer 不會破壞狀態；不能刪新表、吞掉 unknown 或自動退款。

## 完整驗收

- 兩 session 實際 RPC：取消／到店雙向、provider claim／取消雙向、已付／取消雙向；鎖觀察須證明真實阻塞方，不只 Promise mock。覆蓋 NULL 與 false、予約已過期、恢復與衝突 exclusion constraint、settlement／預點單與 bank review 交叉鎖序和 deadlock timeout。
- Stripe/LINE fake provider：每個 crash point（claim commit 前後、provider 呼叫前後、DB 回覆前後）、相同／不同事件並發、webhook 亂序、同 ID 不同內容、response unknown、signed 成功晚到、binding／金額／貨幣不一致、已退款／部分退款；核對 provider call 次數、DB evidence、適當 outbox、不可丟款或誤發成功。
- 測試 DB 寫失敗、空結果／零列、read error、provider timeout、獨立應用版本混跑、rollback、過期 provider idempotency；必須以 DB 最終狀態和實際 API 的回應驗證。真實通知測試使用 sandbox／替身，不發客人訊息；不把假 provider 的計數稱為真實 provider 保證。
- 以授權身份完成真實影響範圍與既有 in-flight 盤點，作出可審查的切換／回復與對帳處置後，才可進一步考慮整體 P1 結案。

## 官方參考與邊界

- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)：API v1 的 key 可能在至少 24 小時後被清除，且同 key 的既有 500 也會重播；不能把固定 key 當永久證據。
- [Stripe currencies](https://docs.stripe.com/currencies) 與 [PaymentIntent](https://docs.stripe.com/api/payment_intents/object)：TWD 收款以兩位小數的最小單位傳值；應核對 `amount_received`，不能只看預計收取金額。這不證明現場曾啟用或收取任何款項。
- [Stripe webhook delivery](https://docs.stripe.com/webhooks)：live mode 重送有限、事件可能亂序；需穩定 event ID 與 durable 接收，不能把 2xx 當資料已安全記錄。
- [LINE Pay Online API v4 request](https://developers-pay.line.me/online-api-v4/request-payment)、[request status](https://developers-pay.line.me/online-api-v4/check-payment-request-status)、[payment details](https://developers-pay.line.me/online-api-v4/retrieve-payment-details)：status 查詢需要 transactionId；依 orderId 的 details 文件涵蓋 confirmed/captured，查無資料不能證明先前 request 未建立。超時與缺 id 需維持 unknown 並採受審對帳。
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)（PostgreSQL License）、現有 repo LINE Pay outbox／settlement row lock：共同鎖序和 transaction 給出可測的 local commit point，外部 provider 副作用仍在 transaction 外。
