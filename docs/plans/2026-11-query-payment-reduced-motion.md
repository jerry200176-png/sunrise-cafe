# 訂位查詢與付款清單捲動偏好（#493 局部）

基準 `3486c48d3514f197ab72cf24e6ff6532b0b28005`。客人開啟改期、跳至繳費回報，以及店員在付款清單移動選取時，程式固定要求平滑捲動；全域 CSS 的 reduced-motion 規則無法更改 JavaScript 傳入的捲動選項。根因是三個呼叫點未讀取使用者偏好，而非查詢、訂位或付款本身出錯。

## 既有功能與方案

搜尋 `scrollIntoView`、`behavior: "smooth"`、`prefers-reduced-motion` 發現 `src/lib/interaction-scroll.ts` 已供 `/book` 使用：每次互動讀取偏好，選擇減少動態或不支援媒體查詢時使用 instant，舊瀏覽器拒絕 instant 時使用 auto。沿用共用函式及原有 `nearest`、`center` 對齊與改期日期欄焦點；付款清單原按選取索引定位，不更動選取、操作或快捷鍵。`auto` 的非動畫降級依賴目前網站沒有 CSS smooth 設定，不是對未知未來樣式或瀏覽器的保證。

替代方案是各頁自行查詢偏好；會重複邊界處理。此改動不攔截自然捲動，不修改訂位、付款、通知、SQL、資料或外部服務。#493 其餘提案與跨頁驗收仍開啟。

## 參考做法

- [W3C WCAG SCR40](https://www.w3.org/WAI/WCAG21/Techniques/client-side-script/SCR40)：互動動態應遵從使用者偏好；不以動畫傳達付款結果。
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) 與 [scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)：分別查詢偏好及選擇捲動方式；保留原始目標和對齊。
- [Cloudflare Kumo sidebar](https://github.com/cloudflare/kumo/blob/main/packages/kumo/src/components/sidebar/sidebar.tsx)（MIT）：程式捲動時依 reduced-motion 選擇動作；僅參考原則、不複製程式。
- 根因是硬編 smooth，症狀是使用者選擇減少動態後仍被平滑移動；在實際互動讀取設定，而非只改 CSS。

## 驗收與回復

以模擬資料測試兩個客人入口及後台選取：一般偏好 smooth、減少動態 instant、偏好在頁面開啟時變更、原目標對齊與改期焦點。沿用既有 helper 測試檢查缺少 matchMedia 與 instant 不被支援的降級；不連正式資料或觸發付款。視環境執行瀏覽器測試；未執行時須明列。回復程式 commit 即可，無資料回復。
