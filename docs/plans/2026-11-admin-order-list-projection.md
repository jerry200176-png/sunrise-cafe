# 後台訂單清單回應投影（#434 部分）

## 現況、根因與邊界

以 main `6ad95b652bde85452d2de962815f881fa744c21f` 為基底。後台訂單清單 API 已有分店授權、active/printable 篩選與 cursor 分頁，但仍將 `orders.*`、`order_items(*)` 直接返回，新增的內部欄位會自動流到瀏覽器。#544 的訂位清單已以 opt-in `v2` 回應投影改善同類問題；保留舊合約是為既有頁籤與未知外部 caller。

盤點：`fetchAllAdminOrders` 的真實 caller 是訂單看板及列印站；前者需訂單 ID、分店、狀態、時間、總額、備註、訂位 ID、桌號、品項 ID／品名／數量／選項名稱；後者另需列印狀態及品項備註。即時通知兩處均只觸發重新讀取，不直接把 payload 當清單；單筆核對及 PATCH 是不同 API，不在本案更改。列印站在收據送出前必須能拿到既有內容與全部分頁；拒絕格式不正確的巢狀資料，避免靜默省略列印內容。

## 參考做法

- [Microsoft API 實作指南](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-implementation/)：以 API 模型與儲存模型分離、明確回應欄位及版本化；投影不能取代授權。
- [TanStack Query 查詢失效](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)與[分頁查詢](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)（[MIT](https://github.com/TanStack/query/blob/main/LICENSE)）：失效後重新讀取、維持整體分頁處理；參考原則，不新增依賴或複製程式碼。即時事件不保證跨頁快照或跨裝置一致。

## 設計與驗收

1. 以 `listContract=v2` opt-in 將結果投影到看板及列印所需欄位，未帶參數時原有分頁與陣列回應完全維持。只在伺服器回應前投影；沿用 `select *` 以容忍既有不同 schema，這不減少 DB 到伺服器的讀取。
2. 巢狀 table、order_items、selected_options 亦依白名單投影；格式錯誤時安全回錯，不能靜默刪除可能需要列印的內容。保留每頁 cursor、排序、全部分頁檢查、角色／分店授權。
3. 看板及列印站明確 opt in；先部署 UI 至舊伺服器時，舊伺服器會忽略新增 query 參數並回傳原資料，客戶端仍執行相同投影與格式檢查，避免部署過渡期漏印。沒有 opt in 的舊 caller 不改。
4. 合成測試覆蓋 v2 排除頂層、巢狀及未來欄位；舊合約維持；權限、分頁、空資料、格式錯誤；確保列印待補單判斷及實際 XML 字串保有必要內容。無實體印表機或正式資料測試。

依既有 schema，訂單及品項備註可為文字或 null、桌號須為文字、總額須為有限數字；`created_at` 可為 null，此時看板顯示「時間未提供」，列印站沿用時間無法判斷時跳過的規則。型別錯誤或缺少必要的巢狀列印欄位使 v2 查詢失敗，不能被投影成空文字或印成 `[object Object]`；是否存在此類正式資料尚未驗證。

範圍不包括 Realtime payload 對資料的資料庫層授權、跨裝置重送、打印與狀態寫入規則；回復為 revert 本案。
