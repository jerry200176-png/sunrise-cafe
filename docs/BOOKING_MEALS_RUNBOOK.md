# 訂位選餐與公開菜單上線

## 上線順序

1. 在隔離環境測試 `scripts/run-production-migration-phase.mjs predeploy`：既有 runner 會依序套用 `migration-reservation-preorder.sql`、`migration-booking-meals.sql` 與一次性的 `migration-preorder-menu-seed.sql`；任一步失敗即停止部署。確認三筆 `schema_migrations` 紀錄、新欄位、函式與 RLS policy。seed 只把目前供應中的既有品項設為可預選，之後店員的個別設定不會被後續部署覆寫。`menu-photos` bucket 由後台首次上傳照片時透過 Storage API 建立。
2. Agent 確認 PR 的必要檢查、獨立證據及下列 R3 執行條件後 squash-merge；`main` 推送會由既有 production workflow 自動執行 predeploy migration、驗證並部署。不需人工貼 SQL。執行者需確認正式環境有與 Supabase API 同專案的資料庫連線設定；缺少時 runner 會停止部署。
3. 部署後確認 `RESERVATION_PREORDER_ENABLED=true`。後台於「菜單管理」設定可於訂位時預選的品項，並貼上或上傳照片。把後台顯示的 `/menu` 完整網址貼到官方 LINE。
4. 從公開網址匿名測試分店切換；建立一筆有餐點的測試訂位及一筆無餐點訂位；後台確認預點內容、到店、逐項出餐與結帳，再取消測試資料。核對 `/api/version` 的 SHA 與預期部署一致。

## 行為與排查

- 餐點送出與訂位建立在同一資料庫交易；無菜色的訂位沿用原建立流程。餐點價格、名稱與選項由資料庫菜單快照決定，客戶端傳入的價格不採用。
- 到店確認建立一筆與訂位唯一關聯的訂單。重複按到店確認會回傳原訂單。未到店的預點餐不列入即時訂單看板；店員可在訂位餐點管理頁修改。
- 每個品項整批標記已出餐；出餐與結帳分開。已出餐品項保留紀錄。菜單變動不改寫舊預點或舊訂單的品名、價格。
- 若新預點餐無法送出，先確認 migration 與 `RESERVATION_PREORDER_ENABLED`；若照片上傳失敗，確認 `menu-photos` bucket 與 5 MB / MIME 限制。

## 回退

應用程式可先回退至前版，資料庫加法欄位及訂位餐點紀錄保留；避免在仍有預點或出餐資料時刪除新欄位或 bucket。若 RLS 驗證失敗，依此版 migration 與前版 policy 的差異，以新受檢 PR 進行限縮修正；不可放寬匿名權限。正式回退走相同已提交的部署流程並再次核對 SHA。

## R3 執行條件

- **目標**：只允許本 PR 通過必要檢查的 HEAD 經 `main` 自動部署；migration runner 核對資料庫專案識別，失敗即停止部署。
- **範圍**：新增欄位、函式、索引及訂位關聯；訂位訂單的匿名讀寫權限收緊。Migration 不刪既有訂位或訂單資料。
- **相容與回復**：舊版程式可在新增欄位保留時運作；必要時經既有產品部署流程回到前版 SHA。保留新資料，不做破壞性 schema rollback。
- **驗證**：predeploy runner 驗證 schema 與 RLS；部署後核對 `/api/version` 的 SHA、公開 `/menu`、一般訂位與訂位選餐流程。任何必要檢查或正式驗證失敗時停止後續變更並走回復流程。
- **既有菜單回復點**：`preorder_menu_seed_changes` 於同一交易記下每個被啟用品項的原值，並啟用 RLS、撤銷匿名及一般使用者權限。若需撤回一次性啟用，以這份紀錄為精確目標；先核對是否已有店員後續編輯，避免覆蓋其設定。
