# QR 點餐價格與匿名寫入審查（#455 / #434）

基準 `origin/main` 9956c702480807201fae92dea1ea7407c187aa5f；參考 PR #455 的 06f5b8cdb8de3406cbe80a57db4b900f970bf3b6。此工作樹僅本地準備，不代表 production 部署或資料庫狀態。

## 確認的缺口

- main 的 `POST /api/orders` 仍以客戶端 `menuItem.price`、`selectedOptions[].delta` 算總額，品名和明細快照也取自客戶端。這是源碼信任邊界問題，未測試正式站，不能推論實際損失。
- repo 的 `migration-booking-meals.sql` 定義讓 anon 建立非訂位 orders/order_items 的 RLS policy。無法由 repo 推定 production 實際 grants、policy 或外部 client，伺服器端定價本身不能防止繞過 API 的直接資料庫寫入。
- #434 還包含其他後台 audit 項目，不能因 QR 定價修補就宣稱整張 issue 完成。

## 準備的 app 修補

從 #455 取回 route、server pricing helper 及測試，在桌位所屬分店查菜單並計算品名、單價、選項加價與總額；拒絕異常數量、未知/停售/跨店項目、無效選項、非 UUID 與過多列。另發現不同選項組可存在相同組名＋選項名，原 helper `.find` 會不確定地選擇其中一個並使用其價格；現在此情況拒絕提交，提示洽店員，避免算錯。這是保守處理；長期應以穩定 option ID 承載選項並支援舊購物車。

客戶端顯示的基礎價或加價與伺服器菜單不符時，拒絕提交並提示刪除舊餐點後重新選擇；實際應收完全由資料庫 numeric 重算。單一資料庫交易插入主檔與明細；送出前本機保存待確認旗標；回覆遺失、壞掉或未明確確認未寫入時保留旗標、鎖住此瀏覽器送出並請店員核對。成功且清除購物車或明確未寫入時移除；若結果仍未知，客人可請店員核對訂單及廚房後，明確確認風險來手動解除（原請求可能稍後完成，解除後重送可能重複），解除不會自動重送。待確認期間菜單及購物車禁止修改原清單。跨裝置、跨分頁同時送出、瀏覽器清除資料不受此旗標保護；此方案不是服務端冪等，仍需要獨立操作識別與復原機制。購物車使用 JS Number 顯示小數時可能出現浮點尾數；不在此擅自變更幣別或捨入政策。

## SQL 候選與上線依賴（均未執行）

PR #455 原樣準備 `supabase/migration-orders-anon-insert-revoke.sql`（SHA-256 `ae95a21bd75b816ac1771a6f3d1041c8c56c4470686f832422ab8c4011b00b17`），移除兩條 anon INSERT policy、收回 anon/authenticated 的表 INSERT 權限並保留 SELECT；對應 `supabase/rollbacks/orders-anon-insert-revoke.sql`（`efe08597fe59b3afd8e2503ef76148dff2290fe728eff50b7d03c63e690d180a`）。候選不接入現有 production migration plan，也不執行正式 schema／資料操作；REVOKE、DROP POLICY 及 rollback 的 GRANT 等皆需符合 repo governance 獨立審核。套用前必須核對實際 policy、RLS、PUBLIC/繼承角色與 grants，以及舊 kiosk 等外部使用者；若與假設不同，既有 rollback 不可視為精確回復。本版 app 依賴新的交易 RPC：必須先由核准程序安裝並核對交易 RPC，才可部署相容 app；之後另審核並決定 anon 權限收斂方式，不能跳過 schema 或退回舊的分開 insert。

`scripts/test-orders-rls-docker.sh` 使用全新 network-none PG17 和 #455 的精簡 RLS fixture；確認原始 anon 可寫、候選後 anon/authenticated 拒寫、service_role 可寫、SELECT 保留、重跑、rollback、再次套用。這不驗證 production ACL/角色繼承、實際 API 部署或所有外部 client；未對正式站送出訂單或修改資料。

## 價格確認與封存分店後續設計

購物車價格不是可信計價來源，但代表客人送出前所看到的內容。先比對客戶端顯示的餐點基礎價及各選項加價與伺服器最新菜單；不同或不完整時回 409，要求重新選餐，任何值都不得用於決定應收。原樣竄改的數字不能造成折扣。只在 API 重查一次仍有 race：查完到寫入之間，店員可能改價或封存分店。

因此候選方案新增受限 invoker 資料庫 RPC：單交易鎖分店、桌位、餐點與相關選項／規則，重新核對原 QR token、封存、在售及伺服器先前核對的快照，依目前資料重新計算，插入訂單與明細並返回 ID。發生改價、停售、封存、選項變更或任一步失敗時整筆回滾，不能退回非原子 insert。桌位查詢 API 也讀取實際 branch.archived_at，缺欄位／查詢錯誤按不可點餐處理。

這需要額外 non-additive SQL（受限 ACL / function）並依治理規則審核；不接正式 migration plan、不可直接部署 app。API、price-change、選項、分店交錯及匿名角色已有本機測試，但仍需獨立複審；現有 QR 允許 anon 直接 INSERT 的另一條繞過路徑仍需要另行核准的權限 SQL。交易內授權、鎖順序、金額精度與早期價格快照的相容性由獨立 reviewer 驗證。

候選 SQL `supabase/migrations/20261031190000_atomic_qr_order.sql` 的 SHA-256 為 `982af028fde7b562f6a9d94bf8707c930012ebde2ef9408a4e972a8ce1f0341c`；若檔案變動，上線審查前須重新計算。函式建立與 service-role 授權需隨同 transaction 執行並驗證 ACL；若須回退應先阻擋 QR 送單並恢復相容程式，不能先刪函式或放寬現有限制。

`scripts/test-atomic-qr-order-docker.sh` 在隔離 PostgreSQL 依序安裝 repository 真實 schema、點餐、預點、分店封存、選項組 migration 及候選 RPC；以合成資料驗證定價與封存交錯、選項改價、token 更換與送單雙向交錯、寫入失敗整筆回滾及 anon/authenticated ACL。另以受限模擬 service_role 授權呼叫；沒有讀取正式資料、沒有驗證正式 Supabase 預設授權。

## 參考做法

- [PostgreSQL row-level locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)（PostgreSQL License）：交易取得一致順序的列鎖後再讀取與寫入，並以 rollback 處理失敗；不是用應用程序記憶體鎖代替資料庫驗證。
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)：以 invoker 權限及明確函式執行權處理跨資料列的單筆交易；實際 service-role grants 仍須另驗。
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)：穩定操作識別碼可解決跨重送的未知結果。本候選目前只有本機保守旗標，不能宣稱已提供該等級保證。

未知結果時不另存整體自由備註；重新整理後提示店員必須核查原訂單與廚房（包含過敏資訊），不能以本頁備註為準。送出 header 與 body 各有 15 秒上限，逾時維持待確認。菜單與購物車會同步其他分頁的購物車變化；舊請求成功前會比對原始清單與隨機本機 marker，已變更則不刪新資料或自動導頁，請店員核對。這些 localStorage 檢查不是跨分頁原子交易，競態及手動解除仍可能重複，不能視為伺服器冪等。
