# 提前選餐：載入及提交結果不明

## 根因與範圍
客人經訂位查詢或成功頁進入 `/book/preorder`。目前讀取、送出與 JSON 解析均無期限；POST 錯誤被當作「送出失敗」並可立即以新 key 重送。服務端先執行資料庫 RPC 再讀取結果，後續讀取失敗可能回 400，因此連 400/409 也不足以證明沒有寫入。資料庫可能已拒絕更新既有 submitted 預點並回傳 `already_submitted`，客人不能被告知新選擇必然已保存。

沿用既有 `fetchWithTimeout` / `readJsonWithTimeout`、候位頁的同分頁待確認模式及查詢入口。每個有效 UUID 訂位在 sessionStorage 記錄 pending/confirmed 狀態，不存 token、餐點、姓名或電話；發出 POST 前先記錄，存取失敗則暫停提交。網路、逾時、不可解析或任何非成功結果保留 pending，指示客人查詢或聯絡店家；讀取結果不足以證明仍在途的舊請求不會晚到，不能自動解鎖或重送。成功須取得可核對格式的服務端草稿資料；已有提交回應（包含服務端直接返回既有記錄、沒有 RPC result 的情況）明示新選擇未必生效，且現行菜單不保證列出所有歷史餐點；不可編輯時隱藏菜單目前的單價與選項加價，請客人向店家核對，不以當前菜單估價宣稱實收金額。提交中同步防止重入與修改備註；頁面讀取失敗提供重試。

此為同分頁風險降低，非跨分頁、跨裝置、清除 storage 後或伺服器端的防重；改開分頁仍需先確認。保守鎖可能在真正送出前就留下，或在確認後維持至分頁關閉；需查詢或請店家協助。訂位資料或餐點需要重新確認時，先前成功不能代表變更已確認，應聯絡店家；不自動解鎖。以 scope 及讀取代次阻止 A→B→A 導覽後的舊回覆覆蓋頁面。新環境／舊模型的實際 server RPC、資料、訂單與付款不在本地 mock 保證內。

## 參考做法
- [Stripe network errors](https://docs.stripe.com/error-low-level)：連線中斷後不能推論操作未執行；安全重試需要穩定服務端契約。
- [Square Create Booking](https://developer.squareup.com/reference/square/bookings-api/CreateBooking)：伺服器支援的冪等識別可幫助判定重試；本次不宣稱本應用跨分頁冪等。
- 既有 `src/app/book/waitlist/page.tsx` 與 `src/lib/fetch-with-timeout.ts`：重用期限和明確未知結果處理，不新增依賴。現有正式 release hold 維持。
