# 桌位編輯與停用（#434 的桌位範圍）

## 問題與盤點
店員目前可新增桌位及顯示 QR，但不能修正桌號或停用桌位。搜尋 admin tables、QR、orders、`is_active`、權限與未合併 PR；沿用既有桌位列表、`orders:write` 與分店授權，不新增權限政策。桌位記錄已有 `id`、`branch_id`、`number`、`qr_token`、`is_active`，沒有版本欄位。

## 方案
使用 `PATCH /api/admin/tables/{id}` 只更新桌號或 `is_active`，禁止更新分店、QR 和 ID；先驗現有角色，再依資料庫桌位分店授權。請求必須帶原桌號和狀態；更新時以兩者及 ID／分店作資料庫條件，衝突回 409、要求重新整理。這防止一般的同時編輯覆蓋，但無法偵測值先改動又變回原值（ABA）。不加新欄位／migration，避免為可逆調整引入 schema 變更；資料庫版本欄位可後續另案評估。

## 顧客與營運影響
停用保留桌位、QR token 和訂單關聯；現有掃碼及送單入口會拒絕停用桌位。送單檢查與新增訂單不是同一交易，因此先前已在途的訂單仍可能完成，不能承諾停用後零訂單。重新啟用沿用同一 QR。既有訂單以 `tables.number` 即時 join，改桌號會改變歷史畫面的桌號顯示，但不改訂單資料；編輯確認時明示。停用前需確認影響，不自動取消訂單。

## 驗收、上線與回滾
假資料測試登入、角色、跨店、嚴格輸入、CAS 衝突、QR／歷史欄位未變、停用及重啟；頁面測編輯、確認、錯誤與切店慢回應。未知寫入以具有隨機操作識別碼的分頁旗標保存最小摘要：新增時為桌號，修改時為桌位 ID 與前後桌號／狀態；不保存 QR token。重新載入後須成功取得受權保護的原分店完整桌位清單，才顯示摘要並由人確認，不自動重送；精確筆數缺失或截斷時拒絕提供可核對清單。瀏覽器 sessionStorage 本身不是同裝置、同來源帳號之間的保密邊界。舊格式或損壞的旗標無法辨識目標時維持鎖定並請管理員協助。旗標不跨分頁或裝置；資料庫沒有桌號唯一約束，既有重複桌號會顯示完整識別碼及警示，不能保證跨請求原子防重。此次不連正式資料或部署；回滾應先停用 UI 新操作並確認已變更桌位的狀態，不能自動刪資料。

## 參考做法
- [Odoo restaurant.table](https://github.com/odoo/odoo/blob/18.0/addons/pos_restaurant/models/pos_restaurant.py)（LGPL-3.0）：以 active 狀態管理桌位並考慮未完成訂單；僅借鑑模式，不複製程式。
- [Square QR 點餐](https://squareup.com/help/us/en/article/7142-set-up-self-serve-ordering-and-qr-codes-with-square-online) 將 QR 對應點餐位置；保留原 ID／QR 降低既有標籤失效。
- 根因是缺少安全修改入口及衝突處理；[PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) 說明分開的讀寫可能競態，因此使用帶原值條件的單次更新，不宣稱其能解決跨表在途訂單競態。
