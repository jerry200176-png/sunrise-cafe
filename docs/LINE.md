# LINE 整合指南

## 雙 Channel 架構

| | 群組 Bot | 客人 Bot |
|---|---|---|
| **env** | `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_CHANNEL_SECRET` | `LINE_CUSTOMER_ACCESS_TOKEN` |
| **用途** | 推播群組通知、接收 Webhook | Push 訂金請求、回覆客人 |
| **需要在群組裡** | ✅ | ❌ |
| **Webhook 設定** | ✅ 需要 | ❌ |
| **程式碼** | `src/lib/line-notify.ts` | `src/lib/line.ts` |

---

## 換群組 Bot（步驟）

1. LINE Official Account Manager → 新帳號 → 設定 → Messaging API → 點進 LINE Developers
2. 取得：Channel Secret（Basic settings）、Channel Access Token（Messaging API → Issue）
3. 把新 Bot 邀請進 LINE 群組
4. 更新 `.env.local`：`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`
5. 更新 Vercel 環境變數（同上兩個）→ Redeploy
6. 在新 channel 設定 Webhook URL：
   - `https://sunrise-cafe-six.vercel.app/api/webhooks/line`
   - 開啟 Use webhook
   - 按 Verify 確認連線
7. 測試：`GET /api/admin/test-line-group`，確認新帳號發出訊息
8. 確認正常後，把舊帳號踢出群組

---

## 換客人 Bot（步驟）

1. 取得新 Bot 的 Channel Access Token
2. 更新 `.env.local`：`LINE_CUSTOMER_ACCESS_TOKEN`
3. 更新 Vercel 環境變數 → Redeploy
4. 確認客人訂位確認流程正常（訂金請求有發送）

> 客人 Bot 不需要在群組，也不需要設定 Webhook

---

## Webhook 流程（客人付款自動偵測）

```
客人傳訊息/截圖 → LINE → Webhook POST /api/webhooks/line
  ↓
驗證簽章（LINE_CHANNEL_SECRET）
  ↓
偵測訂位代號？→ 綁定 line_user_id
偵測付款關鍵字/截圖？→ 標記已付訂金 + 通知群組 + 回覆客人
其他訊息 → 靜默略過
```

**付款關鍵字**：可在後台 → 設定 → 付款關鍵字自訂（預設：末五碼、匯款、已付、截圖…）

**排除問句**：含「嗎」「？」「如何」「怎麼」等自動排除，不觸發付款偵測

---

## 每日自動提醒

- **時間**：台灣時間每日 20:00（vercel.json cron: `"0 12 * * *"` UTC）
- **範圍**：只推大安店明日訂位
- **無訂位時**：隨機發送一則貓咪訊息到群組
- **客人個別提醒**：有綁定 LINE User ID 的客人各自收到個人提醒

手動觸發：後台 → 訂位管理 → 發送明日提醒

---

## 診斷工具

```bash
# 查詢兩個 token 狀態、群組 ID、本月用量
GET /api/admin/diagnose-line

# 測試推播到群組（發一則測試訊息）
GET /api/admin/test-line-group
```

---

## LINE Login（客人綁定）

用於訂位表單讓客人以 LINE 帳號登入，系統取得其 `userId` 存入 `reservations.line_user_id`，後續通知直接 Push 給本人。

相關 env：`LINE_LOGIN_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET`
Callback URL：`https://sunrise-cafe-six.vercel.app/api/auth/line/callback`
