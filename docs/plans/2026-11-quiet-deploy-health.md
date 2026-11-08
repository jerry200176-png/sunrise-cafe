# 部署健康檢查不再推送店員群組（漂移改報 GitHub issue）

症狀是每天版本不一致時店員群組收到「Production 部署異常」，但對現場訂位沒有處置價值。根因是 deploy-health 直接呼叫 LINE 發送版本不一致訊息；此外健康來源失敗會經共用 cron 包裝器再發「Cron 失敗」。不會單純關閉共用 LINE channel 或整個排程，避免漏掉訂位與營運訊息。

方案：版本不一致記錄精簡版本號於伺服器紀錄，原健康回應維持 `ok: false`、版本資訊與 `alerted: false`；GET/POST 的 deploy-health 包裝器停用該排程的 LINE 失敗通知，保留 job_runs 和 ops log。其他 cron 預設仍通知，帳號碰撞檢查維持既有行為。訊息不再建議手動直接部署，應依受控復原流程處理。此變更不會釐清或解除既有部署事故。

參考做法：Google SRE [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) 主張僅通知可行動的對象、減少無效告警；[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)（Apache-2.0）按來源與接收對象路由告警。本案保留可稽核紀錄，僅取消不適合店員群組的部署通知，未引入依賴。既有 `job_runs` 與 ops log 仍依原有配置與服務可用性運作，不宣稱外部告警或實際保存保證。

以 mock 來源驗證版本不一致、查詢失敗、兩種呼叫方法、包裝器異常、其他 cron 預設通知和帳號碰撞警示；尚未送真實 LINE。正式發布前仍須完成事故復原、CI、獨立複核與 release manifest。回退是經正常發布流程還原改動，回退後群組部署告警可能恢復。


Founder 決定（2026-11-06）：部署漂移告警改送 GitHub issue，不再送店員 LINE 群組。新增 `.github/workflows/deploy-drift.yml`（每日排程 + `workflow_dispatch`），只用 `GITHUB_TOKEN`（`issues: write`、`contents: read`），無額外 secret／Vercel token：比對正式 `/api/version` 與 main head（以 API 解析 `main`，不依賴 dispatch 的 ref）。有需處理的差異時開 `Production drift: main <sha7> vs prod <sha7>` issue（label `deploy-drift`），已有未結 issue 則留言；無需處理時留言並關閉。main 最新 commit 不足 60 分鐘視為發布進行中，不回報。`/api/version` 無法讀取時 workflow 失敗（GitHub 的 workflow 失敗通知）。app 端 deploy-health 仍保留 server log 與 job_runs／ops 記錄。

## 2026-11-08：排除非執行期差異

SHA 不同本身不能證明正式站缺少程式更新：現有 `scripts/vercel-ignored-build.sh` 會跳過文件等非執行期變更。原排程只比較 SHA，故文件提交會產生誤報。以正式 SHA 到已解析的 main SHA 的完整差異套用既有 ignore 規則；只在正式 SHA 是 main 的祖先且可安全取得完整差異時，才可判定為非執行期差異並結束舊告警。未知物件、比較失敗或非祖先不可宣稱正常；不使用 GitHub compare API 的檔案數上限。停用 rename 偵測，避免程式移到文件路徑時漏看刪除。告警更新前重核 main 與 production 版本，變動即中止。排程以完整歷史 checkout 固定的 main SHA；不再宣稱沒有使用 action。

參考：[Google SRE 監控](https://sre.google/sre-book/monitoring-distributed-systems/)要求告警可行動；[Argo CD v3.6.1](https://github.com/argoproj/argo-cd/blob/94037c4d4e1af4bd0651d37a179fbd9e347e668c/controller/state.go)（Apache-2.0）以 live/desired 比對，錯誤預設 unknown；其 [comparison 測試](https://github.com/argoproj/argo-cd/blob/94037c4d4e1af4bd0651d37a179fbd9e347e668c/controller/state_test.go)覆蓋比對失敗。此處沿用本專案 build ignore 規則，不複製外部程式。上述排程未在正式環境執行，仍須 exact-head CI、獨立複核及部署授權。

本次候選發佈基準是 `fba352ff13b57b385182b85d8a5e72b8ca069f5c`：2026-11-08 唯讀 `/api/version` 與成功的 code-only release run 42344890659 一致。合併前須重查正式版本、完整差異及回復證據；建立新 manifest 不代表批准部署，若基準已變更須重新準備。
