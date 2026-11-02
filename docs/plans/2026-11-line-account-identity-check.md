# LINE 帳號資訊查詢：避免誤判與無限等待

LINE 帳號檢查原本把帳號資訊 API 的所有非成功回應都稱為 token 無效或過期，即使原因可能是暫時無法確認。這項變更將帳號資訊查詢限制為 10 秒；非成功或中斷時保留身份未確認的結果，避免把供應商異常當成憑證失效。成功回應也只接受非空字串作為帳號識別；其他格式一律視為未確認，不假設特定識別碼格式。

沿用既有唯讀帳號查詢與既有每日帳號比對，不新增警示類型；只有確認兩種用途使用同一帳號時，原本的群組警示才會送出。無法確認的帳號不會被推定為碰撞或不同帳號，但其他已確認的碰撞仍會觸發既有警示。若原本某個帳號資訊查詢持續掛起，逾時可能讓檢查繼續完成，進而送出其他已確認碰撞的既有警示。配額查詢仍使用原有路徑，其等待時間不受此 10 秒限制，因此整份檢查沒有新增總時間保證。

模擬測試覆蓋供應商非成功、帳號資訊請求中斷、未知帳號不推定碰撞，以及其他已確認碰撞仍可觸發既有警示。這項診斷不會證明客人提醒已送達，也不改變提醒流程、訊息重試或資料庫結構。

## 官方參考與範圍

- LINE Messaging API 的 [Get bot info](https://developers.line.biz/en/reference/messaging-api/#get-bot-info) 對應 `GET /v2/bot/info`；這裡只以非空 `userId` 比對已確認的帳號身分，不把顯示名稱當作唯一識別。HTTP 非成功、非預期 JSON 或連線中斷均不是「token 一定失效」的證據；部分帳號無法確認時，沒有碰撞結果也不代表帳號一定不同。
- 既有額度查詢分別使用 LINE 官方的 [每月發送上限](https://developers.line.biz/en/reference/messaging-api/#get-quota)、[當月訊息使用量](https://developers.line.biz/en/reference/messaging-api/#get-consumption) 與 [推播訊息數量](https://developers.line.biz/en/reference/messaging-api/#get-number-of-push-messages) GET API。這些數字與身分檢查是不同結果；推播報表尚未 ready 或查詢失敗時會保留未知，不能據此推定訊息已送達或所有功能正常。
- [Node.js `AbortSignal.timeout`](https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay) 及 [MDN `AbortSignal.timeout`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) 說明提供逾時訊號；此候選只對 bot info 的 `fetch` 提供 10 秒訊號，依賴執行環境與 fetch 尊重 abort。它不是 LINE 服務保證，也不包含配額三個 GET 的期限；`Promise.all` 仍可能等待未完成的配額請求，故不能保證整份診斷在 10 秒內結束。MDN 對瀏覽器描述 active time 在環境暫停時可能暫停；此處為服務端 Node.js，不能將瀏覽器行為當成服務端 SLA。

這些參考查詢均為 GET，不新增推送 API、訊息類型或觸發排程。既有 `deploy-health` 自檢仍可能在確認客人與店員用途共用帳號時呼叫既有群組警示；本次對 bot info 加期限可能讓原本卡住的自檢繼續，進而送出其他已確認的既有碰撞警示，並非保證完全不會發送訊息。未呼叫 LINE 正式 API、未測試實際通知或額度。回復方式：revert 此候選；不要將診斷成功當成客人已收到訊息的證據。

## 後續單次 code-only 候選

本候選預定（proposed）以前版 `22c41cc48348df7b2295569444d1ec27964aff56` 為 baseline，一次性 manifest 僅列本設計、診斷程式及合成測試三個精確 blob。該前版的正式部署與健康監控尚須完成；未來合併或發布時須重新核對正式身分、版本與健康。此候選不改資料庫、LINE quota 查詢、排程或既有碰撞警示的發送條件；合成測試不構成真實送達或正式站穩定性證據。
