# LINE Pay API 串接指南 (Online API v4)

目前程式已完成「每筆訂位專屬 LINE Pay 付款單 → 回呼確認 → 自動標記訂金已收 → 店家群組通知」流程。這解決客人付款後沒有傳官方 LINE、店家無法知道付款人的問題。功能受商戶環境變數 gate 控制，尚未設定憑證時會保留舊的固定付款連結。

## 1. 取得串接用金鑰

從 [LINE Pay Merchant Center](https://pay.line.me/) 的 Payment Integration 取得：

- `LINE_PAY_CHANNEL_ID`
- `LINE_PAY_CHANNEL_SECRET`

兩組金鑰只能放在 Vercel Environment Variables 或本機 `.env.local`，不可寫入 git、聊天訊息或前端程式。

## 2. 已實作的系統流程

1. `/api/linepay/request` 先用電話＋訂位碼驗證客人，金額由伺服器計算，不接受前端金額；成功後建立專屬 `paymentUrl.web` 並寫入 `line_pay_payments`。
2. LINE Pay 將 `orderId` 與 `transactionId` 導回 `/api/linepay/confirm`；系統使用資料庫內的原始訂金金額呼叫 Confirm API。
3. Confirm 成功後更新 `line_pay_payments.status = paid`、`reservations.is_deposit_paid = true`，並推播含訂位碼、客人、時段與金額的店家群組通知。
4. 查詢頁與底部付款列在已設定憑證時使用專屬付款按鈕；付款完成後顯示已自動對應，不要求客人再傳官方 LINE。

## 3. 上線前設定

1. 執行 `supabase/migration-line-pay-payments.sql`。
2. 在 LINE Pay 商戶端允許以下回呼網址：
   - Confirm: `https://sunrise-cafe-six.vercel.app/api/linepay/confirm`
   - Cancel: `https://sunrise-cafe-six.vercel.app/api/linepay/cancel`
   - 建議在 Vercel Production 設定非敏感變數 `NEXT_PUBLIC_APP_URL=https://sunrise-cafe-six.vercel.app`，讓程式產生回呼網址時不依賴 fallback。
3. 以 `LINE_PAY_API_BASE_URL=https://sandbox-api-pay.line.me` 與沙盒金鑰完成一筆 request → payment → confirm 測試。
4. 將正式金鑰放入 Vercel Production Environment Variables，移除沙盒 base URL，重新部署。

LINE Pay Online API v4 的 request/confirm 規格與 HMAC header 請以官方文件為準；交易序號在程式中以字串保存，避免大整數精度遺失。
