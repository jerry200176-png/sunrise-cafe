# Cron 驗證與 Upstash 限流整合

## 問題與既有工作

#456 僅信任受驗證的 cron Bearer，避免任何人用 `x-vercel-cron-schedule` 豁免限流；#519 在 Upstash 超時或無法判定時拒絕請求，保留 SDK 原有共同 prefix。兩者都修改 middleware，直接合併有一處衝突。沿用現有 cron 路徑與限流器，不新增後台通道、不修改資料庫或正式設定。

整合後，只有限定的排程 GET 且 Bearer 符合時才豁免一般 API 限流；偽造 header、錯誤 token、其他路徑或方法不豁免，Upstash 無法判定返回 503，真正超額返回 429。既有限流稽核訊號僅在超額時記錄。舊的共同 bucket 仍有跨類別競爭，舊 worker 在 provider timeout 時仍可能放行，須先證明排空；SDK timeout 不取消 Redis 命令，503 後仍可能產生扣額。退款、權限、cron 時間及 SQL 均不改變。

## 參考做法

- [Vercel cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)：以設定的 secret 保護排程，不信任一般客戶端可自行附加的 header。
- [Upstash timeout](https://upstash.com/docs/redis/sdks/ratelimit-ts/features#timeout)：SDK timeout 的預設成功回傳不可當成實際放行決策。沿用專案既有 MIT 授權的 Upstash SDK，不引入新依賴。
- 根因是排程來源 header 被當成身分，而服務故障被當成可放行；分別在認證與限流邊界 fail closed，並保留原本有效 cron 的明確豁免。

## 驗證及未解限制

本地以合成資料執行兩項目的定向測試，另測合法 cron 在 limiter unavailable 時免限流及偽造 header 仍受 503 限制；不呼叫正式 LINE、Redis 或其他正式服務。真 Redis／多程序、timeout 遲到扣額的隔離證據及限制見 #519；cron 原始證據見 #456。

備援 workflow 的 verify 呼叫仍受一般 API 限流；HTTP 503／500、連線失敗或非 `ok: true` 不能被當作成功。HTTP 200 且 `ok: true` 只表示診斷函式已回覆，其內容仍可能報 `job_runs_ready: false` 或其他問題，不能當作排程、ledger 或 LINE 已就緒。ops-events workflow 的直連成功路徑不變；直連失敗後，缺憑證、fallback 連線失敗、非 200 或回覆未確認成功均使 workflow 失敗，而非假裝 migration 完成；fallback 原有寫入行為未擴大，也不能把其成功當成完整 schema／正式資料驗證。

當前 production `CRON_SECRET` 與 GitHub 備援是否仍存在且一致、所有外部 machine caller、真正 Upstash 配置、排空和復原演練均未確認。正確設定缺失會按設計阻止排程；不得因合成測試成功便宣稱已解除正式發布 hold。此整合不含 migration SQL，也不自動更改正式資料或憑證；回退會恢復 timeout fail-open 與舊 header 判斷，不能視為安全復原。
