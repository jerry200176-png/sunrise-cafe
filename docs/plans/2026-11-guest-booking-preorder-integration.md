# 客人訂位與提前選餐候選整合

#529 整合訂位結果不明防重、減少動態偏好與訂金說明；#532 改善提前選餐的結果不明處理。兩者均擴充 WebKit 的 Playwright 測試清單，直接合併會在 `playwright.config.ts` 衝突。這個候選保留 `booking-flow.spec.ts`、`booking-reduced-motion.spec.ts`、`preorder-recovery.spec.ts` 三組於 Chromium 和 WebKit，並保留各自原始程式與測試，不調整測試斷言或停用任何測試。

兩者的送出保護均只存在同一分頁，不能保證跨分頁／裝置或伺服器端冪等。提前選餐已確認或結果不明時保守停用，若需重新確認或變更應聯絡店家；現行菜單不保證代表歷史項目或價格。詳見 [訂位整合](2026-11-guest-booking-integration.md) 與 [提前選餐](2026-11-preorder-outcome-recovery.md)。這是 draft 整合候選，不代表已上線；既有 release hold 不變，未修改正式資料庫或對外發送訊息。
