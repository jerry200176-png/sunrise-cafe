# 後台頁面載入與分店隔離

## 問題與根因
店員回報部分後台頁面不能載入。唯讀程式檢查發現：今日場控在分店 API 回 503 或空陣列時可能永遠載入；菜單、桌位、訂單及報表等頁把分店或資料 API 錯誤視為空資料；多頁切換分店／日期時舊請求可能覆蓋目前選項。這些條件已從程式確認，但使用者實際觸發的頁面與根因仍待正式登入環境驗證。

獨立檢查另發現桌位與桌位 QR API 未執行現有 `orders:read`／`orders:write` 和分店授權。middleware 的登入驗證不足以限制角色與分店。修復已由獨立安全修補 PR #497 處理，沿用既有權限政策，不新增角色或放寬權限；不對正式站進行越權或寫入測試。

## 現有功能盤點
搜尋 `fetch /api/branches`、loading、retry、`requirePermission`、`fetchWithTimeout`、`FallbackBoundary`、後台頁面與測試；現有 `friendly-error.ts`、`fetch-with-timeout.ts`、`admin-api-auth.ts` 與既有訂單 API 能複用。已查開放 PR，無重複的頁面載入修復。沿用 `SessionGuard` 的登入過期流程；避免引入第二套資料取得框架。

## 方案與架構
1. 延續已獨立合併的桌位、付款及設定 API 角色和分店檢查；僅在本機測試身分與模擬資料。
2. 後台共用分店清單 hook，驗證 HTTP 狀態與資料型態，限制讀取等待時間，區分載入、空清單、錯誤並可重試；卸載後不得寫入狀態。
3. 高風險資料頁的 GET 使用有界等待與請求世代檢查：切店或篩選後舊回應不得覆蓋新資料；錯誤顯示可重試，不把錯誤顯示成空資料。只對讀取提供手動重試，訂位、付款和其他寫入不自動重送。
4. 個別次要區塊失敗不可讓整頁無限轉圈。保留有意義的現有資料，但不能把舊分店資料顯示成新分店資料，也不能讓錯誤狀態觸發錯誤操作。包廂現況、候位、LINE 帳號頁同樣限制讀取等待時間並處理失敗。
5. 列印站在送印前記錄待確認訂單，結果不明時停止自動送印。人工恢復須明確核對紙單並確認，未完成的送印請求不可清鎖；瀏覽器儲存異常時維持安全停印。

替代方案：一次替換為 SWR 或 TanStack Query，會增加依賴與重寫面，且不能自動修好 API 授權或資料契約，這次不採用。另一方案只加全域錯誤邊界，無法捕捉一般非同步請求與 HTTP 錯誤，也不能避免跨店 race。

## UX、驗收及回滾
HTTP 401/403、5xx、網路中斷、逾時與空資料要能區別，提供清楚訊息與重試；手機可操作且遵守既有設計。測試至少涵蓋分店 API 503→恢復、空分店不永久 loading、切店時倒序回應、資料 API 出錯、桌位/QR 的角色與分店隔離。再執行既有測試、lint、build、瀏覽器回歸與 PR 檢查。正常部署流程不變；必要時回滾 PR，無新增資料庫 migration。安全隔離缺口處理完成及檢查通過前停止一般發布。

## 參考做法
- [Next.js 15 error handling](https://nextjs.org/docs/15/app/api-reference/file-conventions/error)：route error boundary 隔離渲染問題；非同步請求仍需自行處理狀態。
- [SWR error handling](https://swr.vercel.app/docs/error-handling)（[MIT](https://github.com/vercel/swr/blob/main/LICENSE)）：錯誤、資料與重試分開處理；依本專案需求沿用現有工具，不直接引入套件。
- [TanStack Query retries](https://tanstack.com/query/latest/docs/framework/react/guides/query-retries)（[MIT](https://github.com/TanStack/query/blob/main/LICENSE)）：讀取失敗採有限重試；不重送付款等寫入。
