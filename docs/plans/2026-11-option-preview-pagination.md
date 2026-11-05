# 選項組預覽完整性（#434 部分）

症狀：現有只讀預覽可能受到 Data API 回傳上限而靜默截斷，也包含已綁定的列，JSON 輸出尾部含非 JSON 文字。根因是單次不帶排序的 SELECT 與遷移的 `set_id IS NULL` 條件不一致。資料查詢跨請求不具快照一致性；今天的結果不能重建遷移前狀態。

方案：按唯一 UUID id 的遞增 keyset 分頁並查至空頁，不假定伺服器上限；篩選未綁定的選項，任何查詢錯誤或排序異常整體失敗。每個資料表最多讀取 1000 頁與 100,000 筆，超過即停止且不輸出部分結果；可能因來源持續增加或 server cap 很小而提前停止。若資料庫尚無 set_id 欄位則停止並改用既有相容 SQL 預覽；不自動改 schema。JSON stdout 為可解析 JSON，限制與提醒送 stderr。缺失關聯不靜默丟棄。程式只執行 SELECT，但 service-role 憑證本身可能有寫入權限。

參考做法：Supabase [range 文件](https://supabase.com/docs/reference/javascript/using-modifiers-range) 提醒分頁須有排序；[PostgREST 資料表與視圖](https://docs.postgrest.org/en/stable/references/api/tables_views.html) 提供過濾、排序及 limits（MIT）。自行實作唯一鍵續查，保留既有 schema 與共用規劃函式。程式使用 JavaScript 排序／數值，不能證明等同 PostgreSQL 簽章；須以現有 SQL 為準。掃描中資料變動、權限/RLS、錯誤的環境連線或服務端缺陷仍可能造成結果不完整；不以此證明正式備份或歷史預覽，未變更任何 migration。

合成測試只攔截假 Data API：模擬較低 server row cap、多頁與空頁結束、已綁定資料篩選、查詢錯誤與結果未排序；亦檢查純 JSON。沒有連接正式服務。
