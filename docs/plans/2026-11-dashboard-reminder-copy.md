# 儀表板提醒文字複製回饋

相關 #493；此修正只涵蓋後台明日提醒的複製，不代表整個 issue 已完成。基準為 main `4371a18a99bb575101e4dcdf9f28a43aeb4fee62`。

## 問題與根因

舊瀏覽器的 `execCommand` 可能回傳 false，儀表板卻仍顯示複製成功；拒絕或例外時提示手動複製，卻沒有呈現完整提醒文字。複製回應若在切換分店後才回來，也可能出現屬於舊畫面的 toast。根因是頁面各自實作非同步狀態、未檢查所有成功條件，也沒有讓回饋隨所屬內容撤銷。

## 既有功能與方案

搜尋 `clipboard.writeText`、`execCommand`、`GuestCopyButton`、後台提醒與既有 copy 設計。#561 新增的 `GuestCopyButton` 已等待寫入、檢查舊 API 布林、提供手動選取、處理焦點、卸載與內容變更；重用它，避免再次維護獨立狀態機。identity 包含授權分店範圍、選定分店、日期、訂位及實際訊息，內容不寫入日誌或儲存。切換分店或內容時淘汰舊回饋；無法撤銷已向瀏覽器發出的剪貼簿操作。

僅修改複製操作，不觸碰標記已通知、傳送、付款或資料庫。剪貼簿成功不代表訊息已發出。失敗時顯示同一可授權提醒的唯讀文字供手動選取；不新增持久儲存或追蹤。

## 參考做法

- [MDN Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)：Promise 成功才確認複製；拒絕時提供恢復路徑。
- [MDN Document.execCommand](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)：舊 API 回傳布林且可能失敗；false 不可當成功。
- [clipboard.js](https://github.com/zenorocha/clipboard.js)（MIT）：分別處理成功與失敗；參考模式，不複製程式或新增依賴。
- 根因 vs 症狀：舊流程錯認操作完成且缺少上下文管理，非單純提示語問題；重用經驗證的狀態機並按目前內容隔離。

## 驗收與界線

以合成資料測試延遲成功、拒絕、舊 API false、焦點恢復及可選取欄位，並涵蓋分店切換、切回及遲到結果。確認複製不會 PATCH 標記通知。保留原先文字與獨立標記按鈕；不聲稱已傳訊或撤銷已開始的瀏覽器複製。以應用程式 revert 還原，不涉及資料回復。
