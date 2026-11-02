# 等位後台：操作結果不明與清單競態

## 根因與範圍

等位 PATCH 會更新 `staff_called_at`，DELETE 會將狀態改為 `expired`；伺服器可能完成後才遺失回應，原頁面未處理拒絕或無法解析的 body，且解除按鈕限制。背景 GET 與寫入交錯時，舊清單也可能覆蓋成功操作。這不代表操作確定失敗，也不能以單次 GET 證明較慢的請求永不落地。

沿用既有讀取超時工具和桌位頁的「先紀錄待核對、明確人工確認」思路：寫入前在本分頁 sessionStorage 記錄紀錄 ID、動作與每次新產生的隨機操作 ID，不存姓名或電話；儲存或產生 ID 失敗不送寫入。卸載後的舊回應不更新畫面或清除新操作的標記。成功必須驗證對應的 2xx payload；不明結果保留鎖、顯示警告，只有成功手動重新讀取並自行確認後才可解除。前端同時只允許一筆等位寫入，寫入期間不接收或啟動背景清單讀取；完成時使舊請求失效。不自動重送，不變更 API、資料庫或權限。原請求可能在核對之後才落地，sessionStorage 不跨分頁/裝置，關閉分頁或清除儲存會丟失保護；本變更不是後端冪等或跨裝置鎖。

## 參考做法

- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)：真正的跨請求安全重試需伺服器端識別及保存結果；本次無後端 idempotency key，不聲稱安全自動重試。
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)：中止客戶端等待不證明伺服器沒有完成；因此超時只標結果不明。
- [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)：每個分頁有自己的 page session；重新整理可保留，但不等同跨裝置互斥。
- [TanStack Query mutation retry](https://tanstack.com/query/latest/docs/framework/react/guides/mutations#retry)（[MIT](https://github.com/TanStack/query/blob/main/LICENSE)）：預設不自動重送失敗的 mutation；此處沿用概念，不引入新依賴，也不將前端失效機制視為服務端鎖。
- 既有 `src/app/admin/tables/page.tsx` 的人工核對模式與 `fetch-with-timeout.ts` 的有界讀取可重用；這次根因是缺少結果未知狀態與讀寫順序控制，UI 提示是局部保護，完整修復需獨立後端 durable 操作契約。
