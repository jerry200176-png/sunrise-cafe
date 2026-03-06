# LINE Pay API 串接指南 (V3)

若未來希望將目前的「人工對帳」改為「全自動串接」（客人在網站點擊 LINE Pay 付款後，成功付款即自動將訂單轉為 `confirmed` 或 `paid`），請參考以下步驟與說明。

## 1. 取得串接用金鑰（Credentials）

若要開發全自動付款系統，必須先從 LINE Pay 特約商店後台取得專屬的 API 金鑰：

1. 前往 [LINE Pay Merchant Center](https://pay.line.me/) 並登入商家帳號。
2. 在左側選單進入 **「管理 (Management)」**或 **「系統設定」**。
3. 尋找 **「管理開發人員 (Manage Link Key)」** 或 **「Payment Integration」** 選項。
4. 輸入密碼驗證後，即可看到（或產生）你的專屬 API 金鑰：
   - **Channel ID** (通常為 10 碼數字)
   - **Channel Secret** (一長串英數字)

> ⚠️ **安全警告：** 這兩組金鑰等同於你商店金錢的控制權，**絕對不可外流或寫進公開的程式碼中**。未來串接時，我們只會把它存放在網站伺服器後台的安全環境變數中（例如 Vercel 的 Environment Variables 或本機的 `.env.local` 檔案）。

## 2. 系統架構調整計畫

當你準備好金鑰並決定開始串接時，系統需進行以下修改：

1. **後端新增 API (`/api/linepay/request`)：**
   - 收到客人的付款請求時，系統向 LINE Pay 發送建立訂單請求 (`Request API`)。
   - 取得一個專屬的 `paymentUrl.web` 授權網址。
   - 將客人導向（Redirect）至該網址進行密碼驗證付款。

2. **後端新增 API (`/api/linepay/confirm`)：**
   - 這是所謂的 Webhook 或 Callback 接收點。
   - 客人付款成功後，LINE Pay 伺服器會把付款成功的結果打回給這支 API。
   - 系統在此 API 核對金額無誤後，向 LINE Pay 呼叫 `Confirm API` 完成請款。
   - 隨後，**系統自動更新 Supabase 資料庫中的訂單狀態為 `confirmed` 或 `completed`**。

3. **前端 UI 變更：**
   - 在客戶的「查詢訂單」頁面中，若狀態為 `pending_payment`（或管理員審核通過後），移除現有的「靜態截圖回報」文字。
   - 取而代之，產生一個真正的「🟢 LINE Pay 付款」按鈕。
   - 客戶點擊後即觸發自動化付款流程。

## 3. 測試與上線

LINE Pay 提供「沙盒測試環境 (Sandbox)」。在正式向真實客人收費前，我們會先用測試金鑰與測試帳號走過整個自動對帳流程，確認資料庫狀態會自動更新後，再切換成正式版金鑰上線。
