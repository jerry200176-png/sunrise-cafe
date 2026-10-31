# #384：分離 migration ledger 與 ACL 檢查

問題：`20260914-bank-transfer-reports` 已在 ledger 時，其 runner 每次 predeploy 仍執行兩次 REVOKE 與兩次 GRANT；production workflow 的 predeploy migrate 和 verify 都呼叫該 runner。Ledger 本應記錄 migration 是否已執行，而不代表每次部署都重新修改 ACL。

盤點：搜尋 migration runners、`production-migration-plan.json`、deployment workflow、`reconcile-migration-ledger.mjs` 和 additive gate。Bank-transfer migration 是 grandfathered 的 predeploy 項目；現有驗證已要求 PUBLIC、anon、authenticated 不得執行兩個 RPC，service_role 必須可執行。其他 preorder 與 booking-meals runner 也會檢查權限，但未發現相同的重複修復。沿用既有計畫、函式及歷史 SQL，不變更其 SHA。

方案：已套用時只讀驗證 schema、ledger 和 ACL，發現 drift 則停止部署並輸出安全診斷；提供獨立只讀 ACL 檢查供明確查證。替代方案是在每次部署自動重設 ACL：雖可能修復既有 drift，卻將權限變更隱藏於 ledger 驗證，且缺乏明確作業證據。此工作不引入新的可執行非 additive SQL，也不修改或繞過 additive gate。實際 ACL reconciliation 如有必要，另準備明確目標、變更、備份、審批與驗證證據，經既有治理與審核路徑處理。

驗收：對 mock DB 證明已套用／正確 ACL 不寫入、已套用／錯誤 ACL 失敗且不寫入、新 migration 沿用原 SQL；獨立查詢拒絕寫入選項，ACL 的 PUBLIC、anon、authenticated、service_role 必須明確匹配；保留既有 gate 和歷史 SQL SHA。不得連線正式 DB 或執行正式 SQL。若 production 有 ACL drift，新版本會中止部署而非自動修復；人工處置並通過唯讀驗證後才能繼續。回滾是還原 runner，但會恢復先前的隱式權限修改。

參考：PostgreSQL [privilege inquiry functions](https://www.postgresql.org/docs/current/functions-info.html) 以 `has_function_privilege` 查有效權限；[Flyway schema history](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/flyway-schema-history-table) 區分已套用的 migration 與驗證。現有專案所用 [Postgres.js](https://github.com/porsager/postgres)（Unlicense）提供 transaction 和參數化查詢，沿用而不複製實作。
