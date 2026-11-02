# 發布監看最後版本無法確認：隔離研究

## 根因和現況

`post-deploy-watch.mjs` 在曾見到預期 SHA 後，只要連續失敗不到門檻，即使最後一輪 `/api/version` 失敗仍回傳 `healthy`；空字串也不會被計入失敗。這可用全合成 fetch 重現，沒有證據表示正式環境曾發生。

現行 code-only workflow 在 release 任一階段不成功時啟動 recovery。`recover()` 僅在目前 alias 指向已記錄 candidate 且狀態為終態時嘗試回復 baseline；alias 指向其他 deployment 或 candidate 未能確定時拒絕覆蓋。單純改成非零會增加觸發既有 recovery 的情境，這是明確的發布行為變更，須一併審查，而不是純顯示文字變更。

## 研究候選

收斂 `commit` 為完整 40 位小寫 Git SHA；缺值、無效內容或讀取失敗為 UNKNOWN。觀察窗口已見預期 SHA 但最後一輪身份未知，回 `identity_unknown`、exit 11，不回 healthy；曾見預期 SHA 後觀察到另一有效 SHA 仍回 `superseded`。中途少量故障但末輪可確認可維持既有容忍規則。預期 SHA 本身無效時在任何探測前停止。

本研究不修改 workflow 或 recovery，不直接設定新的發布暫停。依目前 workflow，exit 11 將使 release 非成功並啟動既有 recovery；D7 要求驗證失敗後自動回復或立即執行文件化回復，D8 在失敗部署或 stop-line 時停止後續發布。是否將本候選採用為正式行為，須對完整 workflow、owner 與 recovery 的能力、可觀察性及 production 影響獨立審查和驗證。

無網路合成測試：19 項 watcher 測試涵蓋末輪 503、空字串、錯誤 SHA、錯誤 JSON、中途未知後恢復、有效不同 SHA 及預期 SHA 不合法。另以 fake Vercel／HTTP 驗證 UNKNOWN 觸發現有 recovery 後，觀察到 alias 為已記錄 candidate 時回復 baseline；觀察到別的部署或沒有 candidate 時拒絕覆蓋。合成反例顯示 alias 在觀測與回滾間被其他 writer 更改時，現有 recovery 仍可能覆蓋新 alias；該案例明示為 expected failure，不把 race 視作已修復。Python watcher／recovery 合成研究目前**未接入 CI**，只能算本次手動測試證據；現有 CI 的 Vitest 涵蓋 watcher 單元測試。

## 界線與風險

- `healthy` 仍是指定時間窗口內的探測摘要，不證明每個 region 收斂、實際訂位／付款／通知成功，亦不意味所有中途探測均成功。
- SHA 相同不能區別兩個部署；此研究不檢查每一輪 deployment ID。外部 writer 可在 alias 查詢與回滾之間競爭；目前 API 無已證實的原子 CAS。candidate 未能保留、runner 中斷、recovery 權限不足、平台不回應或舊資料庫／worker 不相容時，結果仍可能不明。
- `recover()` 的 fake-provider 測試與 watcher 合成 fetch 測試都不能證明 GitHub job 真實排程、Vercel 回滾成功、即時告警、終端使用者或資料庫完整恢復。
- 獨立入口 `production-deploy-migrate.yml` 有不同的監看／回復接線；現階段其首個 job 停用，此研究不為其重新啟用背書。

## 參考做法

- [Google SRE monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/)：監看應區別服務故障與觀測缺失，合成訊號不足時不應宣稱已驗證服務。
- [Vercel rollback](https://vercel.com/docs/deployments/rollback-production-deployment)：復原到指定部署，不能當成跨資料庫的資料回復。
- 本專案 #528 已研究 identity UNKNOWN 與部署 ID；其舊 migration-first pipeline 與目前 code-only pipeline 不同，本候選只研究窗口尾端 SHA 可觀察性，不視為 #528 完成。
