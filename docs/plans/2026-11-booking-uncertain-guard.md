# 訂位結果未知時避免同頁重複送出

## 現況與根因
網站送出訂位時，網路中斷、逾時、HTTP 5xx、無法讀取回應或成功回應沒有訂位代號，均可能發生在資料庫已寫入後。目前畫面雖提示查詢，按鈕與表單事件仍可再次送出；無選餐的 API 直接 insert，沒有用 `booking_request_key` 去重。舊文案「查不到再重新送出」也忽略了原請求可能仍在執行。連續觸發提交時 React state 尚未更新，也不能單靠 disabled 按鈕防止重入。

## 方案
送出網路請求**之前**，將不含姓名／電話的「分店／包廂／起始時間／時長」選擇集合保存在本分頁 sessionStorage，以免請求仍在途時重新整理、前往查詢或 LINE 登入再回來便遺失保護。此頁 hydration 完成前不允許送出；若讀寫失敗或內容損壞，保守停止線上送出並提供查詢與聯絡店家。相同選擇的按鈕 disabled，表單處理器也以同步 ref 拒絕 Enter 或程式化事件。查詢連結與可用的分店電話維持可操作，並說明查不到時仍應向店家確認；改選其他時段可送出，顯示先前仍未確定、可能產生另一筆的警示，回到原時段仍受保護。每個不同選擇使用不同的選餐識別碼；確定的本機驗證或非 408 的 4xx 拒絕移除對應鎖。408、5xx、無法解析及成功缺少代號保守保留鎖；成功取得代號後也保留鎖直到分頁關閉，以免按返回重送已建立的預約。單頁送出中另用 ref 鎖，成功轉頁前不放行重入。

這是暫時的風險降低，不保存身分資訊或新增 DB/API；關閉分頁、清除 sessionStorage、不同分頁或裝置均不受保護，換成不同時段仍可能在先前請求稍後完成時重複訂位。預先記錄後若請求尚未發出即關閉頁面，可能產生保守的誤鎖，需查詢或聯絡店家；不能靠重新整理解除。伺服器端對所有訂位使用原子冪等與未知結果查詢仍需獨立設計／遷移，不能宣稱此處提供端到端冪等。多次未知選擇都在同一分頁保留，避免回切後丟失較早的鎖。

## 參考做法與驗證
- [Square Create Booking](https://developer.squareup.com/reference/square/bookings-api/CreateBooking) 使用伺服器 idempotency key；目前無餐點 API 並未提供等價保證。
- [Stripe 網路錯誤](https://docs.stripe.com/error-low-level) 與[冪等請求](https://docs.stripe.com/api/idempotent_requests)：回應中斷不等於未寫入，確定是否安全重送需要服務端支援；此處只暫停頁面重送並提供查詢。
- [Medusa idempotency 重試討論](https://github.com/medusajs/medusa/issues/16292)（[MIT](https://github.com/medusajs/medusa/blob/develop/LICENSE)）指出換 key 可能失去重試保證；新選擇需獨立 key，舊未知選擇則在本頁不可重送。
- Chromium 覆蓋網路錯誤、5xx、缺少代號、按鈕與 Enter、切換及回切、多次未知、查詢返回、在途重新整理、儲存失敗、明確 4xx 與可用電話；mock API 不建立正式訂位。PR 與 #522 均會修改訂位頁，發布前需重新整合並複核。回退為還原此 PR；不聲稱正式資料已驗證。
