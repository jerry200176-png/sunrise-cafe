# 客人訂位資訊複製回饋

## 問題及根因

客人從訂位查詢或完成頁複製匯款資料、訂位摘要及訂位碼。查詢頁未等待非同步剪貼簿結果，舊式複製也沒有檢查回傳值；其他頁面在權限拒絕時靜默失敗。因此文字可能顯示已複製，實際上未成功，或客人沒有下一步。原因是各處各自管理複製並把「嘗試」當「已完成」，而非付款狀態或帳號錯誤。

## 現有功能與方案

searched: `clipboard.writeText`, `execCommand`, `copyPaymentInfo`, `copyReceipt`, `CopyBookingCodeButton`、開啟的 PR 與既有複製工作。found: `src/app/admin/menu/page.tsx` 與 #516 已等待完成並保留可選取的手動欄位；`BatchDepositMessageWorkbench` 檢查 fallback 布林但綁定後台記錄，不適合客人頁。現有客人查詢、成功頁及訂位碼元件各自複製；不改動原有文字內容。選擇抽取客人共用元件：每個按鈕有獨立 pending、成功、可見的失敗與唯讀手動欄位；只在 API resolve 或 fallback 明確回傳 true 後顯示成功，拒絕或 false 皆可手動選取。重入被同步防止、卸載清理計時與非同步結果；複製內容或訂位身分變更時重建按鈕，丟棄舊的 pending／手動狀態。內容不寫入儲存、日誌或事件。

替代方案是各頁各自補錯誤處理；會繼續複製狀態機且容易讓行為分歧。另一方案只顯示 toast；訂位摘要含動態連結，失敗時客人無法完整手動選取，故不採用。使用現有 Tailwind 樣式與翻譯架構，不新增套件；避免自動傳送任何資訊。

## 驗收、發布與觀察

在中英日語介面，成功須等待瀏覽器確認；拒絕、缺 API、fallback false/exception 時，不宣稱成功並提供帶標籤可鍵盤選取的手動文字；pending 不重送，跨按鈕不互相覆蓋。測試 Promise 延遲／拒絕、fallback 結果、手動欄位、卸載及 A／B 內容切換期間遲到的成功／失敗；以客人頁整合測試或相關元件測試核對各入口。保留原複製文字和既有付款邏輯，不動 API、資料庫、訂金規則或 LINE。依正常 CI 與獨立審查發布；必要時回退應用程式碼，不涉及資料回復。以離線測試及部署後不含客資的人工瀏覽器操作觀察，不新增追蹤事件。

## 參考做法

- 大公司文件：[MDN Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) 說明返回 Promise、需 secure context 且可因權限被拒；以 resolve 而非點擊作為成功依據。
- 開源：[clipboard.js](https://github.com/zenorocha/clipboard.js)（MIT）提供 success/error 分支；本案只參考分別處理成功與失敗，不引入依賴或複製程式。
- 現有產品：後台菜單複製 #516 用等待結果與可手動選取欄位；延續此互動，補客人多語與每個按鈕獨立狀態。
- 根因 vs 症狀：錯誤的非同步狀態判定造成假成功／無反饋；共用明確狀態與可選取 fallback 改善根因，而非僅修改成功提示文字。
