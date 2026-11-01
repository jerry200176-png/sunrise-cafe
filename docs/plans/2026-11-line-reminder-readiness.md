# LINE 提醒 ledger：無副作用的結構檢查

## 根因與現況

部署 runner、正式部署 workflow 與 cold-start bootstrap 都把呼叫 `claim_line_reminder_delivery` 當成檢查，並以固定 UUID 假設不會碰到真實訂位。該函式實際可新增或重新認領資料，且空回應、401/403、schema cache 過期都不能證明安全；runner 和 bootstrap 又會在未知狀態重播包含歷史資料 UPDATE 的 migration。問題是把執行業務操作及自動修復當成可重複的存在性檢查。

## 方案與既有功能

已搜尋 production migration plan、claim SQL、LINE 呼叫端、workflow 與 bootstrap。沿用正式 migration runner 的入口和 PostgreSQL client：以 `REPEATABLE READ READ ONLY` 以內建型別 OID 與 typmod 查 ledger 表結構、唯一約束、精確 RPC 簽名及有效權限，且要求 Supabase URL 和 PostgreSQL direct/Supavisor URL 的標準 project ref 一致；這不證明代理或非標準環境的服務身分。不查 migration ledger 內容，也完全不向 PostgREST 發出請求、不呼叫 RPC，不讀客戶資料、不重新執行 SQL、不刷新 schema cache。環境、連線、狀態、權限或回應不明一律失敗；保留供人工核對的固定錯誤，不輸出服務端回應或憑證。

即使 DB catalog 成功，**migration 版本及 RPC 在 PostgREST schema cache 的可用性仍為 unknown，verifier 必須以非零狀態停止**，不能聲稱部署驗收通過。避免使用可能執行使用者型別 typmodout 的 `format_type`；查使用者 relation 可能觸發 view、rewrite rule 或 RLS 內的自訂函式，因此即使唯讀交易也不查 migration ledger 的內容。隔離實測 PostgREST 12.2.12 對五個必填參數的 RPC，OPTIONS 空值回 PGRST100、合法 filter 值仍回 PGRST202（以無參數查找）；加上同名零參數 overload 後，相同 OPTIONS 回 200，即使撤銷該 overload 的 PUBLIC 與 service_role EXECUTE 仍回 200；因此它不能證明正確簽名或權限，不採用作 cache 驗收。合成 db-pre-request 的 OPTIONS 此次沒有通知，但這只是 v12 單次配置的結果。對虛構 VOLATILE 函式的 GET，以及 cache 保留 STABLE 而函式已改為 VOLATILE 的 GET，兩者均 HTTP 200 並實際觸發 `pg_notify`，不能拿 GET 測試 claim。OpenAPI 根 GET 也可能因 `db-root-spec` 執行自訂函式；PostgreSQL read-only transaction 仍可執行 `pg_notify` 等副作用；合成 PostgREST 的 `db-pre-request` 也證實零筆表 GET 能觸發 `pg_notify`。真正無副作用的 cache 證據機制仍需另行設計及隔離驗證；在此之前本 draft 不能部署，否則 postdeploy 會因 unknown 停止。

移除 workflow 的 POST 探測及 cold-start 的 LINE ledger 自動 DDL；既有 migration 檔不變，其他 bootstrap migration 不在此範圍。若版本或結構有疑慮，須另準備經審查的修復，不從暫時的 PostgREST 故障推論可以重播。另一方案是 rollback 包裝真實 claim，但仍觸發觸發器、鎖或外部副作用；拒用。OpenAPI 根路徑可能配置為函式，也不採用。

獨立手動 workflow 也改成純驗證，必須由既有 GitHub secrets 提供資料庫 URL；移除 Vercel 環境檔匯入。若目前只在 Vercel 提供該設定，手動驗證會 fail-closed，須先用合規方式補足設定；這不是部署成功的證據。

## 參考做法

- [PostgreSQL 系統資訊函數](https://www.postgresql.org/docs/current/functions-info.html)：用 catalog 與 effective privileges 驗證，無須執行業務函式。
- [PostgREST OPTIONS 實作及測試](https://github.com/PostgREST/postgrest/blob/main/test/spec/Feature/OptionsSpec.hs)（MIT）：routine OPTIONS 不執行函式；隔離 v12 實測多必填參數的 OPTIONS 無法匹配，不可作成功證據。
- [Flyway validate](https://documentation.red-gate.com/flyway/reference/commands/validate)（[Apache-2.0](https://github.com/flyway/flyway/blob/main/LICENSE.txt)）：不明或 drift 先停止，不把驗證當作自動修復。

## 驗收與限制

合成測試涵蓋權限漂移／同名不同簽名、專案不匹配與不洩漏服務端錯誤；以隔離 PostgreSQL 驗證 catalog 真正可讀且不執行惡意 ledger view 或 RLS policy。catalog 只能證明所檢查的結構與角色權限；其他角色未檢查，不能證明 RPC 在 PostgREST 實際暴露、function body 的所有業務邏輯或 LINE 實際發送；沒有在正式 PostgREST/資料庫或 LINE 測試。受既有恢復點及發布暫停約束，不合併或部署此 draft。回滾程式變更即可，原 SQL 不動。
