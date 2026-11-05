# 訂位流程尊重減少動態效果

## 現況、根因與範圍

使用者選擇整店 3D 包廂、切換訂位步驟或定位表單錯誤時，`src/app/book/page.tsx` 的 JavaScript 明確要求 `smooth` 捲動。既有 `globals.css` 已依 `prefers-reduced-motion` 停止 CSS 動畫，但不會改寫 JavaScript 傳入的捲動選項；因此開啟減少動態效果仍可能看見平滑移動。`src/` 目前沒有設定 CSS `scroll-behavior: smooth`。

保留既有實景照片、3D 選擇、焦點與訂位／付款流程；僅讓 `/book` 的程式捲動在呼叫當下讀取使用者偏好。選擇減少動態時使用 `instant`，一般偏好維持原本 `smooth`；瀏覽器無 `matchMedia`、查詢失敗或環境尚無 `window` 時保守使用 `instant`。不訂閱常駐事件，也不攔截自然捲動，因此使用者中途變更偏好後，下次操作即可生效。

查詢頁 `/book/query` 另有兩處平滑捲動，本次不修改以避免與既有退款說明草稿 #518 混入同一變更；管理後台亦非本次範圍。選擇 `instant` 是因 `auto` 可能繼承未來 CSS 的平滑捲動；若舊瀏覽器拒絕 `instant`，退回 `auto`（目前專案未設定 CSS 平滑捲動），保持控制項可用。

## 參考做法

- [W3C WCAG SCR40](https://www.w3.org/WAI/WCAG21/Techniques/client-side-script/SCR40) 與 [Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)：JavaScript 可於互動時依使用者偏好降低非必要動畫。
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) 及 [scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)：由使用者偏好選擇捲動行為；不複製程式。
- [Cloudflare Kumo](https://github.com/cloudflare/kumo/blob/main/packages/kumo/src/components/sidebar/sidebar.tsx)（[MIT](https://github.com/cloudflare/kumo/blob/main/LICENSE)）：程式化捲動先讀取減少動態偏好；不複製外部程式。現有 StorePreview 及照片入口保持不變。

根因是 JS 行為未讀取無障礙偏好，症狀是偏好減少動態效果的客人仍看到程式捲動。以 Chromium 真瀏覽器驗證預設及減少動態、現場變更偏好、選取包廂後焦點與照片，以及步驟切換；不操作正式資料。回滾此 PR 可恢復原捲動行為。此為 #493 的可及性子項，不代表整個議題完成。

獨立複核發現送出首次遇到 409／其他非 2xx 時，錯誤區塊尚未掛載便讀取 ref，導致定位失效；因此僅對送出失敗使用提交後的 effect 定位，欄位驗證維持原本的第一個欄位焦點。錯誤區塊不強制取得焦點，避免打斷客人切換到其他控制項；同一錯誤重試仍可再次定位。以模擬 API 檢查首次 409、503 以及兩種動態偏好。
