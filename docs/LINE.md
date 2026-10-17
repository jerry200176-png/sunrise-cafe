# LINE 整合指南

## 雙 Channel 架構（2026-09-29 依正式設定核對）

| | 群組 Bot（貓咪頭像「昇咖啡包廂預約提醒機器人」） | 客人帳號（「昇咖啡 x 大安店」） |
|---|---|---|
| **env** | `LINE_CHANNEL_ACCESS_TOKEN` | `LINE_CUSTOMER_ACCESS_TOKEN` + `LINE_CHANNEL_SECRET` |
| **用途** | 推播店員群組通知 | 推播給客人、回覆客人、接收 Webhook |
| **需要在群組裡** | ✅ | ❌ |
| **Webhook 設定** | ❌（未設定） | ✅ `/api/webhooks/line` |
| **程式碼** | `src/lib/line-notify.ts` | `src/lib/line.ts`、`src/app/api/webhooks/line/route.ts` |

注意：`LINE_CHANNEL_SECRET` 雖然名字像群組 Bot，實際是**大安店客人帳號**的 secret（webhook 簽章與回覆 token 必須是同一個 channel）。

---

## 換群組 Bot（步驟）

1. LINE Official Account Manager → 新帳號 → 設定 → Messaging API → 點進 LINE Developers
2. 取得：Channel Access Token（Messaging API → Issue）
3. 把新 Bot 邀請進 LINE 群組
4. 更新 `.env.local` 與 Vercel 的 `LINE_CHANNEL_ACCESS_TOKEN` → Redeploy
5. **不要改 `LINE_CHANNEL_SECRET`**：它是大安店客人帳號的 secret，改掉會讓客人訊息的 webhook 全部 403。群組 Bot 不需要 webhook。
6. （選用）若要讓新群組 Bot 被拉進群組時自動回報群組 ID，請改用下方「分店專屬群組 Bot」的 `LINE_EXTRA_GROUP_BOTS`。
7. 測試：`GET /api/admin/test-line-group`，確認新帳號發出訊息
8. 確認正常後，把舊帳號踢出群組

---

## 分店專屬群組 Bot（各店用自己的訊息額度）

每間分店可以有自己的群組 Bot（另一個 LINE 官方帳號），該店的店員通知就從它發出、用它自己的每月額度。沒設定的分店照舊用預設群組 Bot（`LINE_CHANNEL_ACCESS_TOKEN`）。

1. LINE Official Account Manager 建立新官方帳號 → 啟用 Messaging API
2. LINE Developers 取得此 channel 的 **Channel secret** 與 **Channel access token**
3. Webhook URL 設為 `https://sunrise-cafe-six.vercel.app/api/webhooks/line`，開啟 Use webhook，按 Verify
4. Vercel 環境變數 `LINE_EXTRA_GROUP_BOTS`（Production）設成 JSON 陣列，**不要貼到聊天或 commit**：
   ```json
   [{ "name": "同德店", "secret": "<Channel secret>", "token": "<Channel access token>" }]
   ```
   設定後需重新部署才生效。
5. 把新 Bot 拉進該分店的 LINE 群組 → Bot 會在群組回覆「此群組 ID：C…」
6. 後台「分店管理」→ 該分店 → 「LINE 群組 ID」貼上 → 儲存

運作方式：發送群組通知時，程式先問 LINE「哪個 Bot 在這個群組裡」（group summary API，不耗額度），用那個 Bot 的 token 發送；結果快取 10 分鐘。分店 Bot 的 webhook 只處理「加入群組」事件，店員在群組裡的對話不會被當成客人付款回報。

依分店發送的通知：新訂位、付款待確認、已付訂金（含 LINE Pay）、改期、候補轉訂位、訂金逾期釋放（僅補送 ADR-012 前的歷史通知）、明日提醒、出席確認。

---

## 分店專屬客人帳號（同德店等，客人加的是該店的官方帳號）

分店有自己的客人官方帳號時，該店訂位的所有客人通知（繳費、提醒、取消、改期、候補、評論邀請…）都由該帳號發送；客人傳到該帳號的訂位代號與付款截圖也會被處理（付款截圖只對應該店的訂位）。沒設定的分店照舊用大安店帳號。

1. 該官方帳號在 LINE Official Account Manager → 設定 → Messaging API → 啟用，Provider 選 **sunrise_cafe**（和 LINE Login 同一個，客人的 LINE 綁定才能共用）。**Provider 選了不能改。**
2. LINE Developers 該 channel → Messaging API：Webhook URL 設 `https://sunrise-cafe-six.vercel.app/api/webhooks/line`，開啟 Use webhook。
3. 發行 Channel access token（long-lived），並記下 Channel secret。**不要截圖、不要貼到聊天或 commit。**
4. 分店必須已在後台建立（需要它的 branch_id）。Vercel 環境變數 `LINE_BRANCH_CUSTOMER_BOTS`（Production）：
   ```json
   [{ "branch_id": "<branches.id>", "name": "同德店", "secret": "<Channel secret>", "token": "<Channel access token>" }]
   ```
5. 以既有流程重新部署（`production-deploy-migrate.yml`，`force_deploy=true`），回 LINE Developers 按 Verify。

客人要**加該店官方帳號為好友**才收得到訊息（推播只會送到好友）。

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

## Flex 卡片（統一版型）

所有營運通知盡量以 **Flex Bubble** 呈現（對齊 DESIGN.md 焦糖品牌色），並附「查看訂位」「開啟官網」等按鈕（類 inline 小站入口）。

| 對象 | 情境 | 建構器 |
|------|------|--------|
| 客人 | 訂金、提醒、候補、綁定、付款回覆 | `src/lib/line-cards.ts` |
| 群組 | 新訂位、付款待審、逾期釋放（歷史補送）、改期 | `src/lib/line-cards.ts` |
| 共用版型 | header / rows / CTA | `src/lib/line-flex.ts` → `flexBubble()` |

**仍為純文字**：診斷測試、明日無訂位時的貓咪彩蛋（`CAT_MESSAGES`）。

Webhook 客人回覆使用 `replyLineFlexMessage`（`src/lib/line.ts`）。

**店內驗收：** 每次 production 部署後跑 [`OPS_LINE_CARD_VALIDATION.md`](./OPS_LINE_CARD_VALIDATION.md)（約 15 分鐘）。

---

## 每日自動提醒

- **時間**：台灣時間每日 20:00（vercel.json cron: `"0 12 * * *"` UTC）
- **Hobby 延遲**：Vercel Hobby **不保證整點準時**，可能在 **20:00–20:59** 之間任一時刻觸發。21:00 後仍無訊息才算異常。
- **範圍**：所有已設定 `line_group_id` 的分店（無設定時 fallback `LINE_GROUP_ID`）
- **無訂位時**：隨機發送一則貓咪訊息到群組
- **皆已通知時**：推一則「皆已通知過」狀態（不重送 digest），避免群組完全靜默
- **同日冪等**：同一台北日若 cron 已成功執行，GitHub 備援／重複 cron **不會重送**（`duplicate_skip`，仍寫 `job_runs`）
- **備援安全窗口**：GitHub 備援預期在台北 21:00–23:59 執行；若排程延遲跨過 00:00，系統會記錄 `schedule_window_skip` / `skipped_by_policy`，不查詢下一天訂位，也不發「無訂位」貓咪訊息。
- **觀測欄位**：每次執行寫入 `job_runs.metadata`：`trigger_source` / `result` / `sent_count` / `skipped_count` / `reservation_count` / `guest_sent_count` / `duration_ms` / `heartbeat`
- **客人個別提醒**：有綁定 LINE User ID 的客人各自收到個人提醒（僅尚未 `is_notified` 的訂位）

手動觸發：後台 → 訂位管理 → 發送明日提醒

診斷：`GET /api/admin/reminders/verify`（需 admin session 或 `CRON_SECRET`），或：

```bash
CRON_SECRET=xxx bash scripts/verify-send-line-cron.sh
```

---

## 診斷工具

```bash
# 查詢兩個 token 狀態、群組 ID、本月用量與今日 push 用量（唯讀）
GET /api/admin/diagnose-line

# 測試推播到群組（發一則測試訊息）
GET /api/admin/test-line-group
```

### 訊息額度保護

明日提醒的空狀態／皆已通知 heartbeat 屬 informational：相同群組狀態 36
小時內只保留第一次提醒，並可由 `LINE_USAGE_GUARD_ENABLED=1` 搭配
`LINE_MONTHLY_MESSAGE_BUDGET`、`LINE_EXPECTED_DAILY_MESSAGES` 啟用異常暴增保護。訂位、付款、逾期釋放、等位與
到店確認等 critical/actionable 通知不會因「本地 quota guard」被抑制；這不代表 LINE
額度耗盡、provider rejection 或終端送達有任何保證。quota guard 預設停用，需先設定
`LINE_USAGE_GUARD_ENABLED=1` 並完成 production quota threshold review。訂金期限 cron
補送 ADR-012 前失敗的逾期釋放通知時，同一批最多將 5 張群組 Flex 卡放進一次 push request；每筆仍有獨立 delivery claim，失敗
仍寫回各筆 ledger。LINE provider rejection 會保留錯誤狀態、寫入 operational logs，並
由 cron failure handling path escalation。

---

## LINE Login（客人綁定）

用於訂位表單讓客人以 LINE 帳號登入，系統取得其 `userId` 存入 `reservations.line_user_id`，後續通知直接 Push 給本人。

相關 env：`LINE_LOGIN_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET`
Callback URL：`https://sunrise-cafe-six.vercel.app/api/auth/line/callback`
