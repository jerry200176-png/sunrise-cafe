# 訂位清單選取狀態（#493 局部）

## 問題與盤點
後台批次複製訂金訊息沿用現有的 `ReservationList`：搜尋 `indeterminate`、`selectedReservationIds`、`全選目前列表`、批次工作台及其瀏覽器測試，確認已有子項、全選目前清單、總筆數、分店切換清除，以及需額外按鈕開啟的批次預覽。根因是父方塊只表示全選或未全選，而篩選／分頁切換會保留清單外的已選資料，沒有表明其數量。

## 方案
在現有核取方塊使用原生 `indeterminate`；計算目前清單與清單外的已選筆數，當清單外非零時顯示明確提示。保留跨篩選的既有選取和手動清除；不因勾選自動操作、不修改批次 API、權限、資料或排序。替代方案是每次切換篩選時清除：可能讓使用者失去有意選取，故不採用。空清單時父方塊停用，清單外選取仍可清除或預覽。

## 驗收與部署
無選取／部分／全選與空清單的狀態正確；以鍵盤 Space 選取；篩選切換準確標示隱藏數，清除及切分店能清除既有選取；開啟批次預覽仍使用使用者實際選的項目，沒有自動傳送。以元件測試模擬讀取和預覽請求並驗證；待 CI 與獨立審核後以一般管線部署，無 migration；可回退應用程式 commit。觀察操作錯誤及服務日誌，無新增追蹤個資。

## 參考做法
- W3C ARIA APG checkbox pattern：子項部分勾選時呈現 mixed，Space 操作核取方塊：https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/
- MDN `HTMLInputElement.indeterminate`：使用原生 checkbox 的 JavaScript 屬性反映部分狀態，與 checked 區別：https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/indeterminate
- React Aria Checkbox（Apache-2.0）：以 indeterminate 表示群組部分選取；本改動沿用原生 input，不引入依賴：https://react-spectrum.adobe.com/react-aria/Checkbox.html

## 切換分店的請求生命週期
獨立複審發現原本未結案清單或批次預覽延遲回覆，可能在切換分店後覆蓋新畫面。分店切換時在繪製前清空選取、清單、預覽與編輯對話框，遞增代次使舊請求的成功、錯誤及 finally 都失效；清單同時以每次請求序號避免較慢的舊刷新覆蓋新結果。歷史記錄和單筆預覽沿用現有序號並在切店時失效，歷史深連結也檢查分店代次。A→B→A 不把第一個 A 的回覆當成目前請求。模擬資料測試涵蓋不同分店、延遲成功及錯誤、切店後新預覽仍在載入、返回第一間分店及不自動複製或傳送。
切換時亦清除前店的繳費設定；新店設定未載入時延用既有通用話術，避免複製到前店匯款資訊。前店設定延遲回覆也須忽略。
