# 明日提醒：店員與客人分離

## 問題及根因
#471：店員 LINE 設定、claim 或更新失敗時，可能在處理客人通知前結束整次提醒。表面症狀是客人未收到訊息；目前沒有足夠正式環境證據確認實際帳號或額度原因。已搜尋 `runSendLineReminder`、`line-delivery`、`line.ts`、`line-notify`、`payment-notify`、`line-account-audit` 與 #472、#478；重用既有獨立 claim、送訊和 #478 的帳號檢查，不新增第二套帳號診斷。

## 設計
店員失敗不能阻斷客人 claim，已取得 provider 受理及之前客人成功結果不能因之後資料庫錯誤歸零。已確定未送出的部分 claim、明確 4xx 拒絕可標記失敗；無法確認是否送達的網路中斷、5xx、未附接受憑據的 409 保持 `sending`，不自動重送。非 provider 的設定、資料庫與 payload 建立失敗記作 runtime error，不虛構 provider 拒絕；回傳與 ops log 均保留未知狀態。資料庫部分 claim 在後續 claim 失敗時，對已知且未送出的 claim 逐筆釋放；釋放失敗保留待查。

替代方案為第一次送出即持久化 retry key 與完全相同 payload，再在 24 小時內依 LINE 規則重試；現有 D-1 摘要沒有持久化 payload/key，需另外設計 migration、payload 隱私與收件人一致性，不能在此次簡化為盲目重送。延續既有 ledger 狀態、不新增 migration、不執行歷史補發或真實 LINE 測試。

## 驗證與回滾
使用 mock 驗證 staff 失敗後仍送 guest、部分 claim 補償和安全重試、provider 接受/拒絕/未知分流、先前 accepted 累計、guest settlement/marker 失敗、資料庫失敗與記錄遮罩；正式資料與真實通知不觸碰。上線後執行既有 health 與 SHA 檢查；必要時回退 PR 並保留待查 claim，不重新傳送不明結果。

## 參考做法
- [LINE 重試文件](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)：5xx/逾時可能已送出，只有首次與後續請求都使用同一 retry key 才能於 24 小時內安全重試；provider 接受不等於對方裝置收到。
- [PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)（[PostgreSQL License](https://www.postgresql.org/about/licence/)）：沿用專案現有原子 claim，避免在應用程式執行非原子的重覆檢查與寫入。
- 根因是 staff 與 guest 的控制流程共用早退、且部分 claim 與 provider 結果未被明確分類；此方案隔離流程並保留不確定狀態，而非只補發通知。
