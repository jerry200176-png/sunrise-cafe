# 排程認證修正（PR #456）

問題：正式環境未設 `CRON_SECRET` 時，可偽造的排程來源 header 讓未授權請求執行排程；相同 header 也能跳過 API 限流。排程負責提醒、訂金期限、部署檢查與 LINE Pay 通知重試。

盤點：搜尋 `authorizeCronGet`、`isAdminCronGetPath`、`isVercelCronRequest`、`vercel.json` 和未合併 PR；沿用現有的 cron 驗證 helper、各 GET route 與 middleware。`/api/ops/ceo-evidence` 亦使用該 helper，且另有 middleware 驗證。

middleware 原本讓排程密鑰通過所有其他 `/api/admin/*` 方法和路徑。盤點實際呼叫後，僅保留備援工作流與診斷腳本的 `GET /api/admin/reminders/verify`、兩個現有 migration 工作流的 `POST /api/admin/migrations/apply-reminded-7d` 與 `POST /api/admin/migrations/apply-ops-events`；已排程的 GET 路徑仍使用原有排程驗證。`apply-market-parity` 雖聲稱接受密鑰，但 repo 未找到呼叫方，不再給予 middleware 密鑰豁免；若有外部手動呼叫者，需改用具權限的管理員 session。兩個已知 migration 例外保留現有行為，持有排程密鑰仍可觸發這兩個遷移，後續應以獨立且最小權限的認證取代。

根因：來源標籤被誤當成可信身分；缺設定時也缺少拒絕路徑。選擇正式環境只接受 Bearer secret，空值回 500；本地開發維持既有行為。僅驗證成功的排程可免一般限流。另一方案是繼續信任 header，無法阻止偽造，因此不採用。這不引入資料庫變更或新的使用者畫面。

驗收：測試設定／未設定／空白 secret、偽造 header、有效及無效 Bearer；所有 `vercel.json` 排程路徑必須拒絕未授權呼叫且不執行工作；測試無效或非排程請求不可藉 header 繞過限流。測試只使用 mock，不呼叫正式排程或發送通知。

上線與回滾：部署前確認 Vercel Production 的 `CRON_SECRET` 已設定，GitHub 備援使用相同值，但不讀出值；監看排程失敗及設定缺失的錯誤。若未設定，上線後排程會停止。回滾應恢復先前部署並立即修正設定；回滾會重新暴露既有缺口。

參考做法：Vercel [Securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) 指示用 `CRON_SECRET` 的 Authorization header 驗證；[OAuth2 Proxy](https://github.com/oauth2-proxy/oauth2-proxy)（MIT）使用服務端設定和認證，而非相信任意來源標籤。此處使用現有實作，沒有複製程式碼。排程供應商標籤只用於來源紀錄，不作為授權依據。
