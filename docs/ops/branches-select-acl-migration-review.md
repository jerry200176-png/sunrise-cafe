# 分店匿名欄位權限：遷移與回復審查包（draft）

**準備與隔離驗證，不得直接執行正式環境。** 目標是收斂 `public.branches` 的 anon SELECT，保留現有公開訪客清單欄位，並讓其他現有角色的權限維持原狀。本包未自動接入 migration plan、未改 additive gate，沒有任何正式 SQL 執行紀錄。版本化候選為 `supabase/migration-20261101-branches-public-column-select.sql`；它含 `REVOKE`，現行 additive gate 應拒絕，必須遵循 F1/F4、SQL gate 和獨立審查，不可用標籤或放寬測試迴避。

## 前置條件（任何一項未完成即停止）

1. #520 的服務端相容變更須先經獨立審查、合併上線，核對實際部署 SHA，並以合成資料驗證 owner／授權員工後台、訪客分店、訂位、候補、付款指引與 LINE 的相容性。本包不聲稱 #520 已部署或這些流程已全部驗證。
2. 盤點所有外部、行動端、後台、RPC／view、維運與其他資料庫 consumer：匿名 `SELECT *`、內部欄位及新增欄位將被拒；未知使用者或依賴即停止。程式搜尋不能排除外部 consumer。
3. 在可信程序中核對同一條資料庫連線的實際 target 為 Sunrise 正式專案 `mzvsothlxamyltaswinj`，核對環境及執行角色、F1/F4 所需 Founder 指示與平台 gate。`current_database()`、角色名稱或 SQL 中自訂 session 參數都無法自行證明 Supabase project 身分；不能只靠它們認定 target。密鑰不寫在文件、命令列、log 或聊天室。
4. 取得適用範圍及新鮮度足夠、可取回且已驗證的還原點；既有 public-only 還原不證明 Storage、Auth 或所有權限可完整恢復。先以 `docs/ops/branches-select-acl-metadata.sql` 唯讀擷取當時表與欄位 ACL、owner、角色繼承、RLS；比對已審查快照並妥善保存，禁止查詢正式分店欄位值。任何漂移都先重新設計與審查。
5. 記錄 exact commit 與 SHA-256，於變更視窗、影響與監測確認後以具有效限的既有部署／作業程序執行。進入 SQL 前的 session acknowledgment 只防止誤觸，不是 target 驗證、Founder 指示或 gate 的替代品。SQL 以單一 transaction 加鎖，對既有 schema、RLS、角色繼承、PUBLIC／欄位 ACL 和執行角色 fail closed；未逐一列出的外部相依仍須另行核對。

## 影響與驗證

保留 anon `id,name,address,phone,open_time,close_time,closed_dates,display_name,rental_notes,deposit_info,archived_at` 的 SELECT；其中 `archived_at` 供篩選。匿名直接讀 `payment_info`、`line_pay_url`、`line_group_id`、其他未授權欄位以及 `SELECT *` 預期受阻；未來欄位預設不公開。`deposit_info` 是現有公開 API 契約，未檢視其真實內容。這不改 RLS、封存列可見性、authenticated／service-role 權限或其他 anon 寫入 grants。

執行前後分別保存 metadata 快照並比對：anon 表級 SELECT 消失；唯 11 欄有 anon 有效 SELECT；PUBLIC、角色繼承、其他角色 grants 與 RLS 符合變更前快照；匿名明確公開欄位查詢可用、敏感欄位及 `select=*` 被拒，服務端授權流程和網站健康正常。真實客人、付款、LINE 與私人欄位不可用於冒煙測試。PostgREST 可見性／快取及外部 consumer 仍需在對應環境驗證，不可由 PostgreSQL ACL alone 代替。

目前 anon 也有表級 TRUNCATE；PostgreSQL RLS 不限制直接 SQL TRUNCATE，惟不因此推定正式匿名 HTTP 有 TRUNCATE API 或正式 DB 對外可連。這份候選**不撤銷**該權限；請獨立盤點資料庫連線／角色切換和 consumer，再另提最小權限與審核包。

## 回復

`docs/ops/rollback-20261101-branches-public-column-select.sql` 是針對已審假設的候選 rollback；先比對預存完整 ACL 快照、RLS 和執行目標，任何 drift 停止並重新設計。其 session acknowledgement 只是操作人聲明。它會撤銷新增欄位 grants 並恢復原 anon 表級 SELECT，**會重新暴露內部欄位**；僅在明確評估替代緩解、發布回退、洩露風險及既有 F1/F4 後使用，不能視為安全預設。完成後對照原快照及服務健康，記錄重新開放的風險。此 rollback 不保證還原變更前後其他人的 ACL 變更。

## 隔離驗證

`scripts/review-branches-acl-migration-postgrest.sh` 僅使用本機既有 PostgreSQL 17、PostgREST 12、Node 映像、internal Docker network、合成角色／JWT／資料，實際執行此包的 forward 和 rollback；不連線正式服務。驗證未確認及 PUBLIC 異常時 forward fail closed、公開欄位與服務端讀取、敏感欄位／`select=*` 拒絕、未來欄位不自動公開、schema/ACL 漂移與未確認 rollback 被拒，以及 rollback 後合成 ACL 快照精確一致。HTTP 測試只針對合成 PostgREST，未測正式 Data API 或外部使用者。

## 參考做法

- Supabase [Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security)：表級與欄位級授權疊加；不可假設 RLS 會過濾欄位。長期拆分公開／私有資料表可降低混合欄位風險，需另行規劃。
- PostgreSQL [GRANT](https://www.postgresql.org/docs/current/sql-grant.html) 與 [REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html)（PostgreSQL License）：以 transaction 和最小欄位 grant 控制生效。
- PostgREST [Tables and Views](https://postgrest.org/en/stable/references/api/tables_views.html)（MIT）：以隔離 API 驗證真實欄位存取語意，不把僅有 mock 的結果視為 HTTP 相容性。
- 根因是表級 SELECT 超過訪客需求；API 回應遮欄只是症狀緩解。此草案移除 anon 表級 SELECT，仍保留外部 consumer 盤點和正式治理作為落地前提。
