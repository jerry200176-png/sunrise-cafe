# 明日提醒：店員與客人分離

## 問題及根因
#471：店員 LINE 設定、claim 或更新失敗時，可能在處理客人通知前結束整次提醒。表面症狀是客人未收到訊息；目前沒有足夠正式環境證據確認實際帳號或額度原因。已搜尋 `runSendLineReminder`、`line-delivery`、`line.ts`、`line-notify`、`payment-notify`、`line-account-audit` 與 #472、#478；重用既有獨立 claim、送訊和 #478 的帳號檢查，不新增第二套帳號診斷。

## 設計
店員失敗不能阻斷客人 claim，已取得 provider 受理及之前客人成功結果不能因之後資料庫錯誤歸零。已確定未送出的部分 claim、明確 4xx 拒絕可標記失敗；無法確認是否送達的網路中斷、5xx、未附接受憑據的 409 保持 `sending`，不自動重送。非 provider 的設定、資料庫與 payload 建立失敗記作 runtime error，不虛構 provider 拒絕；回傳與 ops log 均保留未知狀態。資料庫部分 claim 在後續 claim 失敗時，對已知且未送出的 claim 逐筆釋放；釋放失敗保留待查。未取得 claim 時唯讀查詢原紀錄，`sent` 能視為已完成；`sending`、`failed` 或無法讀取不會誤報成功。紀錄不存在時再唯讀訂位最新狀態；確認已取消、該通道已標完成或客人已無 LINE 才略過，仍可能發送或有其他群組歷史則待查。HTTP 失敗按狀態分類，不讀取或記錄供應商回應本文。

分店群組同時認領 `legacy-group` 共用 key 與目前分店 key，阻止新版處理器互相繞過。歷史 legacy key 未保存實際群組，僅有 legacy `sent` 不能證明新分店的 recipient；其他分店 key 曾存在也保守待查。舊版程式卻不會認領此共用 key：若舊版排程／手動請求在新版查詢之後才開始送到舊分店，新舊版仍可能重複送。只有資料庫層統一約束所有版本，才能在混跑時消除這個競態；目前方案必須避免混跑。

## 發布交接：避免新舊提醒處理器並行
1. 安排非提醒時段交接。先以平台支援的方法暫停正式環境 `GET /api/admin/reminders/send-line` 的排程，並停用或封鎖所有正式環境對同一路徑的手動 `POST`、外部排程／重試及舊部署 URL 的呼叫；不要只依賴 Vercel cron 設定，因為手動與舊部署也能觸發。其他提醒工作不應一併停用。
2. 依平台執行紀錄確認排程及手動呼叫已停止，並確認所有既有 `send-line` 執行都已結束；不能只以固定等待時間推定完成。無法證實所有入口停用或舊執行已排空時，停止發布，不切換分店群組設定或重新啟動提醒。
3. 經既有發布管線部署審核版本，確認正式環境 health 與 `/api/version` 的 SHA 為預期版本，且外部排程與手動入口不再指向舊部署。檢查待查 ledger 的狀態時只讀，不清除、不重設、不補發未知結果。
4. 確認交接條件均滿足後，再恢復正式環境排程及手動入口；追蹤錯誤與 unresolved 計數，對未知發送結果人工核對。驗證使用既有唯讀健康檢查，不對真實客人或群組試送。

回退到舊版前也必須先重複停用入口與排空；舊版無法遵守新版 guard，不能在有未知 claim 時直接恢復排程。若平台無法安全隔離或排空舊版，需先完成資料庫層跨版本協調方案，不能將這份文件視為已解決混跑。

替代方案為第一次送出即持久化 retry key 與完全相同 payload，再在 24 小時內依 LINE 規則重試；現有 D-1 摘要沒有持久化 payload/key，需另外設計 migration、payload 隱私與收件人一致性，不能在此次簡化為盲目重送。延續既有 ledger 狀態、不新增 migration、不執行歷史補發或真實 LINE 測試。

## 驗證與回滾
使用 mock 驗證 staff 失敗後仍送 guest、部分 claim 補償和安全重試、provider 接受/拒絕/未知分流、先前 accepted 累計、guest settlement/marker 失敗、資料庫失敗與記錄遮罩；正式資料與真實通知不觸碰。上線後執行既有 health 與 SHA 檢查；必要時回退 PR 並保留待查 claim，不重新傳送不明結果。

## 參考做法
- [LINE 重試文件](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)：5xx/逾時可能已送出，只有首次與後續請求都使用同一 retry key 才能於 24 小時內安全重試；provider 接受不等於對方裝置收到。
- [PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)（[PostgreSQL License](https://www.postgresql.org/about/licence/)）：沿用專案現有原子 claim，避免在應用程式執行非原子的重覆檢查與寫入。
- 根因是 staff 與 guest 的控制流程共用早退、且部分 claim 與 provider 結果未被明確分類；此方案隔離流程並保留不確定狀態，而非只補發通知。
