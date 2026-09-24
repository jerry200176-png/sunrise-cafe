# 訂位選餐與公開菜單上線

## 上線順序

1. 在隔離環境測試 `scripts/run-production-migration-phase.mjs predeploy`：既有 runner 會先套用 `migration-reservation-preorder.sql`，再套用 `migration-booking-meals.sql`；任一步失敗即停止部署。確認兩筆 `schema_migrations` 紀錄、新欄位、函式與 RLS policy。`menu-photos` bucket 由後台首次上傳照片時透過 Storage API 建立。
2. 完成獨立審查與 Founder 核准後合併 PR；`main` 推送會由既有 production workflow 自動執行 predeploy migration、驗證並部署。不需人工貼 SQL。執行者需確認正式環境有與 Supabase API 同專案的資料庫連線設定；缺少時 runner 會停止部署。
3. 部署後確認 `RESERVATION_PREORDER_ENABLED=true`。後台於「菜單管理」設定可於訂位時預選的品項，並貼上或上傳照片。把後台顯示的 `/menu` 完整網址貼到官方 LINE。
4. 從公開網址匿名測試分店切換；建立一筆有餐點的測試訂位及一筆無餐點訂位；後台確認預點內容、到店、逐項出餐與結帳，再取消測試資料。核對 `/api/version` 的 SHA 與預期部署一致。

## 行為與排查

- 餐點送出與訂位建立在同一資料庫交易；無菜色的訂位沿用原建立流程。餐點價格、名稱與選項由資料庫菜單快照決定，客戶端傳入的價格不採用。
- 到店確認建立一筆與訂位唯一關聯的訂單。重複按到店確認會回傳原訂單。未到店的預點餐不列入即時訂單看板；店員可在訂位餐點管理頁修改。
- 每個品項整批標記已出餐；出餐與結帳分開。已出餐品項保留紀錄。菜單變動不改寫舊預點或舊訂單的品名、價格。
- 若新預點餐無法送出，先確認 migration 與 `RESERVATION_PREORDER_ENABLED`；若照片上傳失敗，確認 `menu-photos` bucket 與 5 MB / MIME 限制。

## 回退

應用程式可先回退至前版，資料庫加法欄位及訂位餐點紀錄保留；避免在仍有預點或出餐資料時刪除新欄位或 bucket。正式回退須走相同審批流程。
