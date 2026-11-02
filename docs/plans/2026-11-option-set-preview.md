# 選項組 SQL 預覽範圍（#434 部分）

既有預覽把所有選項列納入；實際 migration 只使用 `set_id IS NULL`，因此 migration 後預覽可能把已合併的選項誤列為將再次合併。預覽選項顯示也取文字最小值，與 migration 依 item ID 選代表餐點的規則不同。

SQL 預覽以 PostgreSQL 的 `to_jsonb(row)` 讀取可選欄位，支援 migration 執行前沒有 `set_id` 與執行後有該欄位的 schema；在 DB 自身使用 migration 同樣的簽章與代表 item 排序。只修改獨立預覽，不變更已發布的 migration。原資料可能在查詢間變動、同 display_order 的顯示順序仍可能不同；如需一致快照，應由具適當權限的操作者在唯讀交易內執行，且不代表歷史狀態。

既有 migration 的簽章使用 `numeric::text`：數值相等但儲存精度不同的 `1.0` 與 `1.00` 可能產生不同簽章並分組。此預覽忠實呈現該既有行為，不表示它們會視為相同，也不變更既有 migration。

參考：[PostgreSQL JSON functions](https://www.postgresql.org/docs/current/functions-json.html) 的 row-to-JSON 與缺鍵回傳 null 行為；[aggregate ordering](https://www.postgresql.org/docs/current/functions-aggregate.html) 的有序 array 聚合。兩者使用 PostgreSQL License；本次自行撰寫 SQL，未複製程式碼。驗證採無網路、合成的本地 PostgreSQL 測前後 schema、混合資料、重複選項、正負加價、`1.0` 與 `1.00` 精度、等量不同簽章與代表餐點，並將結果與原 migration 的合併區塊在臨時資料表執行後比對。

保留限制：目前預覽沒有分店篩選，`to_jsonb` 篩選加彙總可能掃描整張選項表，未驗證正式資料量與耗時；無法憑當前資料重建遷移前正式預覽；TypeScript 工具仍有分頁、JSON 及與 PostgreSQL 排序／數值簽章不一致的問題，不能視為精確預覽。測試工具固定使用 root 擁有的本地 Docker socket、清空 Docker 相關環境、禁網且只使用已存在的映像；仍依賴本機 Docker host 可信。此變更不關閉 #434，未讀取正式資料。

## 同名分店／餐點的輸出辨識

舊輸出以分店名與餐點名稱顯示，分店同名或餐點同名時，即使資料庫已按 ID 分組，人仍可能把不同來源認成同一筆。兩個查詢應保留既有可讀欄位，第一個查詢額外顯示分店 ID 與按餐點 ID 排序的 `{id, name}` 配對，第二個額外顯示分店 ID 與餐點 ID。名稱與 ID 在同一個 JSON 物件內對應，避免兩個分別排序的清單無法配對；只讀查詢與 migration 的合併規則不變。

參考：[PostgreSQL JSON 聚合](https://www.postgresql.org/docs/current/functions-aggregate.html) 說明 `jsonb_agg` 可指定聚合順序（PostgreSQL License）；本次自行撰寫。以隔離合成資料加入同名分店與同名餐點，檢查結果可區分，並逐組比對原 migration；不使用正式資料。既有查詢結果會多兩個欄位，若有自訂外部消費者依欄位數解析，需自行調整；這不是已知存在的正式使用情況。
