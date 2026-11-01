# ops-events、LINE readiness 與 cron 安全整合

## 問題與選擇

#533、#525 分別移除 ops-events 與 LINE reminder 在未知探測後自動寫 SQL 的路徑；#531 修正 cron 身分與限流故障，並移除 ops-events workflow 的 HTTP fallback。三者在 bootstrap 和 ops-events workflow 衝突。此整合保留 ops runner 的固定 nonzero、LINE catalog 驗證後仍 nonzero、無 HTTP 寫入 fallback，以及有效 cron Bearer 限定豁免。未改任何歷史 SQL、權限設定或 SQL gate。

進一步核對發現 cold-start bootstrap 的 market parity 仍可能把包含缺表文字的 REST 錯誤視為缺欄，LINE guest delivery 更將未知狀態視為缺表，兩者均可能自動執行 SQL。為避免未知→DDL，本候選將 `runBootstrapMigrations` 改成不連線、不探測、不寫入的相容 no-op。它不是 schema readiness 檢查；新環境不再藉 cold start 建立任何這些結構，須以另行審查的 migration／初始化流程建立。其他 standalone runners 並未因此全部修復。

## 參考做法

- [PostgreSQL READ ONLY transaction](https://www.postgresql.org/docs/current/sql-set-transaction.html)：唯讀交易用於限制資料庫寫入，不證明任意服務與函式無副作用。
- [PostgREST tables/views](https://docs.postgrest.org/en/stable/references/api/tables_views.html)：REST／schema cache 的不可用不能當成 DDL 授權；[Vercel cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) 以 secret 驗證，而非來源標籤。
- 沿用現有 Upstash SDK（MIT）與 Postgres.js（Unlicense）；原 SQL 和 additive gate 不變。根因是把未知探測等同缺失，且把可偽造 header 當成授權。

## 阻擋與驗收界線

ops-events runner 和 LINE reminder runner 目前即使部分檢查成功仍固定失敗；兩者位於 production postdeploy phase，因此此候選不可直接合併或部署。須另證明目標、ledger、完整 schema／ACL 及 PostgREST RPC 可用性；`OPTIONS`／部分 REST 投影不足以證明。ops GET 的 `limit=0` 診斷預設不啟用，但 pre-request、view 或 RLS hooks 仍可能執行，不能泛稱無副作用。

診斷在 `NODE_TLS_REJECT_UNAUTHORIZED=0` 時拒絕發送憑證；本機自簽憑證測試覆蓋停用驗證、未受信任與明確受信任三種情況。這不證明設定的 HTTPS 目標是正確專案，亦不消除 hooks 風險。

其他 standalone migration runners、LINE 未知發送結果、正式 cron secret／Upstash 設定與舊 worker 排空、備份恢復及 release hold 均未解。這次未整合 #527／#472：現有 reminder 與 guest deposit request 在非 production 環境的 ledger unavailable 分支仍可能不帶 claim 發送；若非 production 誤連真實 LINE／資料，此風險不能忽略。停用 bootstrap 也不能使這些 runtime 路徑變安全，須先另行修正及驗證。限流同 prefix 可減少混版雙額度，但舊 worker timeout 仍會放行。需保留原 gate 並真實報告其對歷史非 additive SQL 的結果；不得以改名、修改白名單或標籤繞過。若三個來源 PR 有更新，應重新整合並執行 exact-head CI、獨立審查；回退會恢復舊的 fail-open 路徑。
