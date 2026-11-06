# 部署健康檢查不再推送店員群組（漂移改報 GitHub issue）

症狀是每天版本不一致時店員群組收到「Production 部署異常」，但對現場訂位沒有處置價值。根因是 deploy-health 直接呼叫 LINE 發送版本不一致訊息；此外健康來源失敗會經共用 cron 包裝器再發「Cron 失敗」。不會單純關閉共用 LINE channel 或整個排程，避免漏掉訂位與營運訊息。

方案：版本不一致記錄精簡版本號於伺服器紀錄，原健康回應維持 `ok: false`、版本資訊與 `alerted: false`；GET/POST 的 deploy-health 包裝器停用該排程的 LINE 失敗通知，保留 job_runs 和 ops log。其他 cron 預設仍通知，帳號碰撞檢查維持既有行為。訊息不再建議手動直接部署，應依受控復原流程處理。此變更不會釐清或解除既有部署事故。

參考做法：Google SRE [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) 主張僅通知可行動的對象、減少無效告警；[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)（Apache-2.0）按來源與接收對象路由告警。本案保留可稽核紀錄，僅取消不適合店員群組的部署通知，未引入依賴。既有 `job_runs` 與 ops log 仍依原有配置與服務可用性運作，不宣稱外部告警或實際保存保證。

以 mock 來源驗證版本不一致、查詢失敗、兩種呼叫方法、包裝器異常、其他 cron 預設通知和帳號碰撞警示；尚未送真實 LINE。正式發布前仍須完成事故復原、CI、獨立複核與 release manifest。回退是經正常發布流程還原改動，回退後群組部署告警可能恢復。


Founder 決定（2026-11-06）：部署漂移告警改送 GitHub issue，不再送店員 LINE 群組。新增 `.github/workflows/deploy-drift.yml`（每日排程 + `workflow_dispatch`），只用 `GITHUB_TOKEN`（`issues: write`、`contents: read`），無額外 secret／Vercel token，也不使用第三方 action：比對正式 `/api/version` 與 main head（`github.sha`，與 `record-head` 語意相同）。不一致時開 `Production drift: main <sha7> vs prod <sha7>` issue（label `deploy-drift`），已有未結 issue 則留言；一致時留言並關閉。main 最新 commit 不足 60 分鐘視為發布進行中，不回報。`/api/version` 無法讀取時 workflow 失敗（GitHub 的 workflow 失敗通知）。app 端 deploy-health 仍保留 server log 與 job_runs／ops 記錄。
