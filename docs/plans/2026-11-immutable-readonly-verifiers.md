# 歷史 migration 的唯讀驗證整合

## 症狀、根因與範圍
#523 和 #507 去除舊 runner 的隱式重播／權限寫入後，既有 additive gate 仍因 runner 變動而重掃未變的歷史 SQL，依設計拒絕。根因是 plan 將「可執行 SQL 的 runner」和「只讀驗證」混成同一種能力。不能靠改名、空 SQL、忽略 findings 或放寬 grandfathered 清單處理。

本候選只處理 bank transfer、LINE Pay、market parity 的舊自動執行路徑：刪除三個可寫 runner，歷史 SQL、ledger 與原 additive gate 不變。plan 的三組原始 identity 只允許固定的唯讀 verifier、原階段和原 SQL 類別；固定 registry 檢查 verifier 與其直接依賴雜湊，且不可用任意腳本路徑、未知 verifier、原 runner、變動的歷史 SQL 或移除 identity。每次 predeploy/postdeploy phase 中的順序及驗證失敗時停止該 phase 不變；既有 workflow 中 phase 可能各執行兩次。既有 deploy.sh 失敗被 workflow 當作 warning 的問題不在此修正範圍，因此不聲稱整條部署流程 fail closed。獨立 market workflow 只能經同一 registry 執行該 verifier，不能再呼叫已刪舊 runner。其他歷史 runner 完全不在此範圍。

bank verifier 使用單一 repeatable-read READ ONLY transaction 查 ledger/catalog/指定角色 ACL；缺少 ledger／權限錯誤即停止，不引導寫入。LINE Pay 與 market verifier 只發固定 REST 表 GET、不直接呼叫 RPC；使用 `limit=0` 且拒絕任何非空回應，僅證明所選 REST 欄位被接受，不證明完整 catalog、ACL、migration ledger 或目標身分。只允許一般 TLS 驗證的託管 `*.supabase.co` HTTPS origin、拒絕憑證關閉驗證與所有 HTTP 重導；此限制不證明正確專案，客製網域／自架環境需另行審核支援。新環境若尚未建立舊 schema 必須依治理另備 migration 與 recovery 流程；不自動建立 schema 或偽造 ledger。

## 參考做法
- PostgreSQL [read-only transaction](https://www.postgresql.org/docs/current/sql-set-transaction.html) 以資料庫交易拒絕寫入，但不保護任意 Node module 或其他連線；因此此處同時固定 verifier 清單、程式及依賴內容並測試不可重引入自動路徑。
- [PostgREST transactions and pre-request hooks](https://docs.postgrest.org/en/stable/references/transactions.html) 的 GET 使用 read-only transaction，但仍會執行 pre-request hook；不把 REST cache 故障解讀為可重新執行 migration 的授權，也不因此宣稱整個請求不可能產生外部副作用。
- [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations) 保留已套用版本與 checksum；歷史檔和 ledger 在此保持原樣，不重寫歷史。沿用專案既有 Postgres.js（Unlicense）與原 additive 分類器，不引入新套件。

## 驗證與限制
需保留 grandfathered 集合凍結測試，證明改動／新增 non-additive SQL 仍被原 gate 擋下。另測 protected identity 被移除、替換 runner、phase、SQL 或 verifier、未知 verifier、依賴內容變動、舊 workflow 引用、異常 REST、read-only transaction 寫入拒絕與失敗阻斷順序。固定雜湊不是防範能同時改程式和更新 registry 的惡意提交；所有變更仍需正常 exact-head CI 和獨立 review。真實 Supabase grants、其他角色及正式目標均不在合成測試保證內，仍維持 release hold。

## REST 安全邊界與測試

Node fetch 預設追隨 302 時，跨來源仍可能轉送自訂 `apikey`，目的地也能回傳假 200。驗證器現在採 `redirect: error`，嚴格限制 HTTPS origin、禁止 URL userinfo／自訂路徑／query／fragment 和非標準 port，並拒絕 `NODE_TLS_REJECT_UNAUTHORIZED=0`。使用固定 REST table path、選取欄位與 `limit=0`，限制 response body 大小及等待時間；不印 URL、憑證或 response body。TLS 驗證仍依賴執行環境的信任根、DNS 和安全 runtime，host 格式不能驗證這就是授權專案，不能防範同時控制可信 CA／環境或修改 registry。

兩個本機合成 origin 驗證 302 不觸及第二個服務；自簽憑證驗證 TLS 失敗。隔離 PostgreSQL 17 + PostgREST 12 測試中，`limit=0` 返回空陣列且仍檢查所選欄位及權限，但合成 pre-request hook 確實會執行。`limit=0` 不代表完全不讀取資料或沒有副作用：實際 PostgREST hooks、view/function、稽核、外部連線及 proxy 行為未檢查；需依正式環境先行盤點和授權。本 PR 不直接執行 SQL，不能因此聲稱 REST 請求對真實服務絕無寫入或外部副作用；release hold 維持。
