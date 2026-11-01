# 選項組 SQL 預覽範圍（#434 部分）

既有預覽把所有選項列納入；實際 migration 只使用 `set_id IS NULL`，因此 migration 後預覽可能把已合併的選項誤列為將再次合併。預覽選項顯示也取文字最小值，與 migration 依 item ID 選代表餐點的規則不同。

SQL 預覽以 PostgreSQL 的 `to_jsonb(row)` 讀取可選欄位，支援 migration 執行前沒有 `set_id` 與執行後有該欄位的 schema；在 DB 自身使用 migration 同樣的簽章與代表 item 排序。只修改獨立預覽，不變更已發布的 migration。原資料可能在查詢間變動、同 display_order 的顯示順序仍可能不同；如需一致快照，應由具適當權限的操作者在唯讀交易內執行，且不代表歷史狀態。

參考：[PostgreSQL JSON functions](https://www.postgresql.org/docs/current/functions-json.html) 的 row-to-JSON 與缺鍵回傳 null 行為；[aggregate ordering](https://www.postgresql.org/docs/current/functions-aggregate.html) 的有序 array 聚合。兩者使用 PostgreSQL License；本次自行撰寫 SQL，未複製程式碼。驗證採無網路、合成的本地 PostgreSQL 測前後 schema、混合資料、重複選項與代表餐點。

保留限制：無法憑當前資料重建遷移前正式預覽；TypeScript 工具仍有分頁、JSON 及與 PostgreSQL 排序／數值簽章不一致的問題，不能視為精確預覽。此變更不關閉 #434，未讀取正式資料。
