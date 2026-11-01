# 分店欄位最小權限：準備與相容性

狀態：**草稿；此 PR 不含、也不執行正式環境權限 migration。** 訂位網站的 `/api/branches` 對訪客只選必要欄位，但資料庫的 `branches` RLS 是列政策；若 Data API 暴露該表，匿名用戶可能直接選到 LINE 群組 ID、付款資訊等內部欄位。根因是資料庫表級 SELECT 範圍大於應用 API 輸出範圍。服務回傳已驗證客人的付款資訊與店員訊息需要既有資料，不能直接刪除或對所有人封鎖付款指引。

## 現況與先決條件

- 唯讀 catalog 查詢顯示目標專案自訂 ledger 已有 `20260715-rls-catalog-read-only`，branches RLS 已啟用，anon 僅有 `SELECT USING (true)` policy；沒有 PUBLIC table-level SELECT 或明列 column ACL，anon 未繼承其他角色。這是特定時間的快照，非未來執行前驗收；未查詢欄位值或客戶資料，亦未實測 Data API。
- `fetchPublicBranches` 目前只查 `id,name,address,phone,open_time,close_time,closed_dates,display_name,rental_notes,deposit_info`，並以 `archived_at` 篩選。訪客只需上述欄位與 `archived_at` 的查詢權限。`/api/branches` 後台 owner 使用完整資料；非 owner 在服務端限制分店並只保留經授權付款欄位。完整讀取改用既有的 server-only service-role header，不再依賴匿名 `SELECT *`。沒有 service role 時 fail closed。
- 訪客已驗證的訂位查詢使用服務端 `supabase-admin` 讀付款資料；LINE 提醒、催繳及分店訊息使用 server service role。公開訂位成功頁已有 `deposit_info` fallback；不得宣稱這些流程已由整合測試或真實第三方驗證。
- 不修改封存列 RLS：目前 policy 為 true，網站以條件篩選封存分店，若表透過 Data API 暴露，直接呼叫仍可能看到封存列的白名單欄位。封存資料的列範圍與歷史訂位相容性需獨立設計與驗證。

## 候選權限變更（僅供獨立審查）

正式變更需新的版本化 migration，**不可修改或重跑舊的 migration**。在 transaction 內先核對 live project identity、既有 SELECT ACL、column ACL、PUBLIC 及 anon 角色繼承、全部既有政策和確切欄位；任何與已審查合約不同或有未知 consumers 即停止。候選做法是撤銷 anon 的 branches 表級 SELECT，再只對以下明確公開欄位授予 anon 欄位 SELECT：

`id, name, address, phone, open_time, close_time, closed_dates, display_name, rental_notes, deposit_info, archived_at`。

不可只 `REVOKE SELECT (line_group_id)`：表級 SELECT 仍會允許所有欄位。不可在尚未調整並驗證所有 `SELECT *` 讀取前切換；也不能忽略 PUBLIC、繼承角色或明列 column grants。候選不修改 authenticated、service_role、LINE 存取、資料列或封存政策。已觀察的 authenticated 目前有表級 SELECT 但無對應 SELECT policy；變更它屬獨立權限決策。需測試新欄位預設不會自動公開；所有依賴直接 anon Data API 的外部客戶端尚未盤點。

## 安全發布與回復

1. 先部署本 PR 的相容讀取，確認 owner、staff、manager、finance scope；訪客清單、候補、訂位成功及驗證後查詢；LINE 模擬訊息及付款指引。不能用真實訂單、真實付款或真實 LINE 作冒煙測試。
2. 用合成 schema 在隔離 PostgreSQL 測 table/column ACL、RLS 和授權鏈，另外在隔離 PostgREST 模擬 JWT 測公開明確欄位、`select=*`、拒絕受限欄位，以及 service-role 讀取；目前無真實 PostgREST 證據。現有本機 PGlite 僅用於基礎權限模擬，不取代正式環境。
3. 由正式現況生成有確切 SQL/hash/目標/校驗與回復計畫的新 migration，獨立審查並遵守 F1/F4。安全發布必須採 app 相容在前、權限收緊在後，避免公開功能與後台查詢中斷。
4. 恢復策略需依事先保存之權限快照精確恢復，不得盲目授予表級 SELECT，否則會再次公開內部欄位；恢復與應用版本配合，並記錄資料庫權限變更。需重新驗證匿名欄位、服務端權限、合成測試和實際網站健康。

`scripts/review-branches-privacy-pglite.mjs` 只建立記憶體中的合成資料庫，無連線參數，測試匿名白名單可讀、敏感及未來欄位和 `SELECT *` 被拒、RLS 限制寫入、service-role 讀取，以及 authenticated 表級授權未變。可使用隔離安裝執行：`npm install --prefix /tmp/sunrise-privacy-pglite --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.14`，再執行 `PGLITE_PREFIX=/tmp/sunrise-privacy-pglite node scripts/review-branches-privacy-pglite.mjs`。這只驗證簡化 fixture，不驗證現場授權鏈、Data API schema exposure、PostgREST、真實角色或匿名 token。

## 參考做法

- [Supabase Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security)：表級與欄位級權限互相疊加；受限角色無法使用 `SELECT *`。官方提醒多數產品應優先獨立私有資料表；本候選保留既有架構以降低遷移範圍，長期可拆表。
- [PostgreSQL GRANT](https://www.postgresql.org/docs/current/sql-grant.html)（PostgreSQL License）：欄位授權及角色繼承；不複製程式碼。
- [PGlite](https://github.com/electric-sql/pglite)（Apache-2.0）：在記憶體內執行合成 PostgreSQL 權限測試；不連線外部服務。
- 既有 `/api/branches` 的顯式公開字段及角色範圍控制；資料庫 RLS（按列）和 ACL（按欄）各司其職。
