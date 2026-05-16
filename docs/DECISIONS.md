# 技術決策紀錄（ADR）

記錄重要的技術決策、當時的背景與取捨。AI 閱讀此文件可避免「好心重構掉關鍵設計」。

---

## ADR-001：LINE 雙 Bot 架構

**決策**：群組通知與客人個人通知使用兩個獨立 LINE Official Account。

**背景**：原本用同一個 Bot。後來發現群組 Bot 的訊息也會被客人看到，且 token 安全性需要分開管理。

**取捨**：
- ✅ 群組通知與客人通知互不干擾
- ✅ 換群組帳號時不影響客人通知
- ⚠️ 需管理兩組 token，設定複雜度增加

---

## ADR-002：付款偵測用關鍵字比對，不串接 LINE Pay API

**決策**：透過 Webhook 偵測客人傳的文字/截圖，而非串接正式 LINE Pay API。

**背景**：LINE Pay 正式串接需要申請商家資格、審核週期長。店家目前用人工對帳（匯款末五碼），自動化只需判斷客人有沒有傳付款訊息。

**取捨**：
- ✅ 零申請成本，快速上線
- ✅ 支援所有付款方式（匯款、LINE Pay 截圖皆可）
- ⚠️ 依賴關鍵字，有誤判風險 → 已加問句排除機制
- ⚠️ 無法100%自動驗證金額，仍需人工確認截圖

**未來**：若需全自動，見 [docs/LINE_PAY_INTEGRATION.md](./LINE_PAY_INTEGRATION.md)。

---

## ADR-003：明日提醒只推大安店

**決策**：Cron Job 推播訂位提醒，只篩選大安店的訂位。

**背景**：系統初期只有大安店在使用群組通知功能，其他分店未建立對應 LINE 群組。

**影響**：若未來新增分店且需群組通知，需修改 `send-line/route.ts` 的篩選邏輯，或改為每個分店有獨立群組 ID。

---

## ADR-004：時區統一用 toLocaleString 轉換

**決策**：所有需要顯示台灣時間的地方，一律用：
```ts
new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }))
```
而不用 `date-fns-tz` 或其他套件。

**背景**：Vercel serverless 跑 UTC，直接用 `new Date()` 或 `parseISO()` 顯示時間會差 8 小時。這個轉換方式不需要額外套件，在所有 Node.js 環境皆可用。

**注意**：此方法產生的 Date 物件再做計算可能有問題，只用於**格式化顯示**，不用於計算時間差。

---

## ADR-005：Supabase RLS 只開放 INSERT

**決策**：`reservations` 表的 RLS policy，匿名用戶只能 INSERT，不能 SELECT 他人訂位。

**背景**：防止惡意爬取所有訂位資料。查詢自己訂位透過電話號碼作為識別（service role key 在後端執行）。

---

## ADR-006：print-bridge 不部署到 Vercel

**決策**：熱感印表機橋接服務（`print-bridge/`）獨立在店內電腦執行，不部署雲端。

**背景**：熱感印表機需要 USB/網路連接，Vercel Serverless 無法存取本機裝置。

**運作方式**：店內電腦執行 `print-bridge/index.js`，前台廚房列印站發送 HTTP 到本機 port，bridge 再轉給印表機。
