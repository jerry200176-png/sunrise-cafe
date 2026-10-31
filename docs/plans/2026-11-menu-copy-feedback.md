# 菜單網址複製回饋設計

相關 #493（完成按鈕回饋的一個獨立場景，非關閉條件）。基準為 origin/main `21efadf6018fa5a08d2ba931d7b456bbc3fc23d4`。

## 現況與根因

菜單管理的「複製網址」直接 await Clipboard API，只在成功後顯示既有 Toast。使用者拒絕權限、瀏覽器不提供 API 或呼叫失敗時，promise 被拒絕但沒有使用者可讀的結果，也沒有顯示可選取的網址。這是操作狀態與復原途徑缺失；並非菜單資料或伺服器寫入失敗。

盤點既有功能：`ToastStack` 有可讀取的成功／失敗通知；`/menu` 是既有公開菜單入口。沿用兩者，不新增套件或改動資料與權限。#509 已處理訂位勾選狀態，不重做其功能。

## 參考做法

- [GOV.UK confirmation pattern](https://design-system.service.gov.uk/patterns/confirmation-pages/)：確認訊息對應實際完成。這裡只在剪貼簿 promise 成功後顯示成功，不把按鈕點擊當作完成。
- [IBM Carbon notifications](https://github.com/carbon-design-system/carbon/blob/main/packages/react/src/components/Notification/Notification.mdx)（[Apache-2.0](https://github.com/carbon-design-system/carbon/blob/main/LICENSE)）：狀態通知應被讀屏器宣告、不中斷焦點；參考原則，不複製程式碼。
- [MDN Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)：寫入需安全環境，可能因權限拒絕；不支援與失敗均提供可選取文字。
- [Square Catalog 批次更新](https://developer.squareup.com/reference/square/catalog-api/BatchUpsertCatalogObjects)：伺服器寫入另需冪等機制；本次僅複製文字，不以頁面鎖宣稱可解決跨裝置寫入。

## 設計與驗收

1. 顯示唯讀、附標籤且鍵盤可聚焦的完整網址，亦提供原生連結開啟菜單。手機可長按選取，鍵盤可在欄位選取並複製。
2. 點擊後按鈕顯示「複製中…」且停用；同步鎖避免短時間重複呼叫。僅 promise resolve 後顯示成功。
3. API 不存在、同步例外及 promise reject 均顯示明確失敗與手動複製指引，網址欄位持續可用，可再次嘗試。
4. 驗證剪貼簿延遲／成功／拒絕／不支援與連續點擊，以及鍵盤可達的手動欄位與連結；不存取正式資料。

範圍只限客人菜單網址複製，不更動付款、訂位、通知或寫入行為；也不宣稱解決跨分頁／裝置競態。回復方式：revert 此 PR。
