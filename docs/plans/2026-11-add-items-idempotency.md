# 訂位現場加點安全確認（#441）

## 根因及方案
店員送出加點後，資料庫可能已寫入，但回應遺失。重新建立操作會重複送餐。只鎖按鈕、內容全域去重或先分開寫 ledger 都不能同時處理回應遺失、並行與刻意再點相同餐點。兩個入口共用隨機 request key；後端保留既有角色、分店、訂位狀態與菜單快照檢查，以 service-role invoker RPC 鎖訂位再鎖訂單，原子寫入唯一 ledger 和全部品項。同 key 同 payload 重播已提交結果，同 key 不同 payload 拒絕；不同 key 可以刻意再點。

瀏覽器 localStorage 僅存 version、訂位 ID 和隨機 key，不存品項、品名、選項或自由備註。遇未知結果保留識別資料並阻擋該瀏覽器另行加點；重新整理或登出不自動清除。經原有角色及分店授權可查結果：已提交或已取消才能清除，查無紀錄仍是未知。店員可明確選擇安全取消；取消 RPC 在同一鎖順序下檢查結果，已提交就回 committed，未提交就寫 durable canceled tombstone，確保原請求晚到時不寫入。取消失敗、逾時、權限失效或回應未知均保留紀錄。僅在兩個明確狀態或加點確認成功後清除；不能自動以新 key 重送。UI 說明識別碼保留與取消結果。原型 v1 的項目在讀取該訂位時會先縮減成識別資料。

限制：識別資料仍可關聯訂位；瀏覽器清除、換裝置或不同分頁各自生成不同 key，不受同 key 去重保護。服務端沒有全訂位 admission 阻擋，不能宣稱跨裝置未知意圖自動去重；作業時需先核對訂單。無自動 TTL；ledger/tombstone 刪除會失去對延遲請求的保護，保存與清理期限需經營運、隱私和資料庫負責人審查。這不是已批准的隱私政策。

## 狀態競態
舊 `updateStatus()` 分別查詢和更新，可能以過期 ready 蓋掉新加點的 preparing。候選 migration 增加兩個觸發器：訂位餐點 INSERT/UPDATE/DELETE 後，在現有 item guard 已持有的 order lock 內更新衍生狀態；訂位 order 的 status 或 paid_at UPDATE 前重新依目前明細與新 paid_at 計算。兩者均在原寫入交易內執行，覆蓋加點、出餐、改項目/數量、刪除、settlement RPC、舊流程收款與撤回、activation 寫入；非訂位訂單不套用。觸發器也防止舊版 app 寫回過期 status。新版 route 不再執行獨立狀態重算。這依賴已部署的 `guard_reservation_order_item_change` 對每次明細操作鎖 order 的既有契約，以及 READ COMMITTED；必須以實際 production schema、trigger、交易隔離與所有直接 SQL writer 複審。已存在的過期狀態不會主動回填。

## 本地測試與限制
- 本機合成資料與 mocks 驗證兩操作入口、逾時、回應遺失、重整／未授權、最小化儲存、查詢及安全取消；不使用真實客資。
- `tests/run-reservation-add-idempotency.sh` 以 network-isolated PostgreSQL 17 容器測同 key 競態、rollback、角色 ACL、結束後重播、取消 tombstone，以及先出餐/先加點、阻塞後的舊狀態寫入、paid/add、cancel/add 交錯。測試只使用精簡 schema 模擬 guard 和 paid_at 更新；**不等於完整 production schema、實際 settlement RPC 或付款驗證**。
- `tests/research-add-items-postgrest.py` 另以本機既有 PostgreSQL 17、PostgREST 12 與真實 supabase-js 執行合成資料的角色拒絕、同 key 重送與並發、失敗回滾、取消及結帳後重播；加點／取消 HTTP 競爭只驗證兩種合法結果，不保證每次均在資料庫鎖上重疊。此測試使用 `--network none` 的共用網路 namespace、合成角色與金鑰，沒有開放主機 port 或正式資料；**不代表真實 Supabase grants/RLS、Next API 授權、正式 schema、真實斷線或其他 writer 已驗證**。執行方式為 `python3 tests/research-add-items-postgrest.py /absolute/path/to/node_modules`，不下載映像。
- `tests/run-real-reservation-settlement-race.sh` 在另一個 network-isolated PG 容器依序執行 repo 的 `schema.sql`、點餐、預點、booking meals、結帳等實際 migration 與候選 migration，使用真實 `guard_reservation_order_item_change`、總額 trigger 及 `settle_reservation_checkout`。合成資料驗證 add-first 時舊金額結帳回 `amount_changed` 且無結帳紀錄；settlement-first 時加點回 `order_cannot_add`，兩情境都確認後到交易確實等待鎖。容器以 postgres 執行、模擬必要角色和 publication，並非所有專案 migration 或 Supabase 預設授權，也沒有實際付款；正式 schema/ACL 及其他 writer 仍需獨立驗證。腳本內執行的 `schema.sql` 含 DROP，僅能使用腳本自行建立並銷毀的空容器，不可改指向現有資料庫。
- 如需強制跨分頁／裝置去重，需另設有生命週期的 reservation-level admission/查詢及交錯測試，不能假定不同 key 同一意圖。

## 未執行 migration 的影響與回退
SQL 原檔 `supabase/migrations/20261031173613_reservation_order_add_items_idempotency.sql` 尚未加入正式 migration plan，也沒有在 production 執行。其 SHA-256 請以執行前重新計算並與審查版本核對。現有 additive linter 擋 REVOKE、CREATE OR REPLACE、函式內 UPDATE 及 GRANT EXECUTE；不得修改 gate、冒用 grandfathered 或假造批准。先上 app 而無 schema 會拒絕加點，新版其他操作也依賴觸發器更新狀態，不能直接部署。

| SQL 動作 | 影響 | 回退原則 |
| --- | --- | --- |
| 新增 `reservation_order_add_requests`、RLS、限制 table ACL | 初始空表；唯一鍵與 committed/canceled 狀態保存結果，不修改既有資料。外鍵隨訂位／訂單刪除會 cascade，審查保留策略。 | 上線後不可清空／刪除 ledger，否則失去已提交及已取消的證據；維持 RLS 與受限 ACL。 |
| 新增 `add_reservation_order_items_once` 及其 service-role-only ACL | 在單一交易中鎖訂位與訂單、校驗 key/hash、寫 ledger/餐點及狀態；失敗整筆回滾。 | 保留函式與 ACL。舊版不保證重送，退版前應阻擋加點並處理待確認操作。 |
| 新增 `cancel_reservation_order_add` 及其 service-role-only ACL | 與加點共鎖；先提交者決定 committed/canceled，未提交時插入空內容 tombstone。 | 保留函式與 tombstone，不以刪表回退。 |
| 新增 `derive_reservation_order_status`、order BEFORE trigger | 修改訂位 order 狀態時根據明細與 paid_at 在相同交易重算，舊 app 的 status 值會被取代；一般訂單不受影響。 | 先維持觸發器；移除需先確保沒有新舊 app 依賴，否則狀態可能失準。 |
| 新增 `refresh_reservation_order_status_after_item`、item AFTER trigger | 訂位明細新增、修改、刪除會在相同交易更新 order 狀態，增加每明細的查詢與 order 更新；失敗使整筆明細操作回滾。 | 同上；需評估既有 trigger、鎖順序、延遲與 deadlock。 |

上線前需取得符合治理規定的 schema 執行路徑，獨立審核 exact SQL、物件是否已存在、ACL、schema recovery point、真實 schema 測試與相容發布順序；再確認受限函式、trigger 與 ledger 皆已就緒。不可對正式站以真實客人加點或付款做驗證。回退保留 ledger 和觸發器；退回不支援 key 的 app 前須阻擋加點，不能承諾安全重送。

## 參考
- [Stripe 冪等請求](https://docs.stripe.com/api/idempotent_requests)：同一操作重用 key，參數不符拒絕。
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)：資料庫交易及函式權限。
- [PostgreSQL row-level locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)：固定順序持列鎖與交易序列化。
