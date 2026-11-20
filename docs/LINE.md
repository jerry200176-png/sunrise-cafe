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

依分店發送的通知：新訂位、付款待確認、已付訂金（含 LINE Pay）、改期、候補轉訂位、訂金逾期釋放、明日提醒、出席確認。

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

## 聊天室訂位（按鈕選包廂／日期／時段）

客人在客人帳號的聊天室點按鈕訂位，最後一步開已帶好資料的 `/book` 填姓名、電話、人數並送出。
聊天室不收個資；時段要到 `/book` 送出才保留。全部用 reply（不吃推播額度）。

| 事件 | 回覆 |
|---|---|
| postback `a=book` | 包廂卡片（每張有 LINE 內建日期選擇器，今天～一個月內） |
| postback `a=date`（含 `params.date`） | 可開始的時間（最短 2 小時放得下才列；一頁 12 個＋「更晚的時段」）；公休或訂滿給「換一天」「排候補」 |
| postback `a=start` | 可選時長（只列到下一筆訂位前放得下的） |
| postback `a=dur` | 確認卡片＋「填資料完成訂位」→ `/book?branchId&roomId&date&start&duration&line_user_id` |
| postback `a=mine` | 這個 LINE 帳號接下來的訂位（分店帳號只列該店） |
| postback `a=info` | 分店地址、電話 |

- 對話狀態全放在按鈕的 postback data，不存資料庫。看不懂或過期的按鈕一律回主選單。
- 空位計算與 `/api/availability` 共用 `resolveDay` + `roomSlotsForDay`；是否可訂仍以 `/api/reservations` 送出時為準。
- 分店自己的客人帳號只列、只訂該店的包廂；預設帳號列出沒有自己帳號的分店（多家時先選分店）。
- 程式：`src/lib/line-booking-menu.ts`（訊息）、`src/lib/line-booking-chat.ts`（讀資料）、`src/app/api/webhooks/line/route.ts`（分流）。
- 還沒有底部選單（rich menu）時客人不會送出 postback，看不到任何變化；加好友歡迎訊息與底部選單一起上（先單一帳號試點）。既有的訂位代號、付款截圖流程不變。

---

## 底部選單（rich menu）

四格：**我要訂位**（最大）｜我的訂位｜看菜單｜店家資訊。圖片 `public/line/richmenu.png`（2500×843），格子與動作在 `src/lib/line-richmenu.ts`。客人也可以直接打「訂位」「預約」「選單」叫出同樣的按鈕。

發布與移除（要先登入後台，在後台頁面的瀏覽器 Console 執行）：

```js
// 只給一位 LINE 使用者試用（userId 是 U 開頭 33 碼）
await (await fetch("/api/admin/line-richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish", userId: "Uxxxxxxxx…" }) })).json()
// 全帳號預設
await (await fetch("/api/admin/line-richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish" }) })).json()
// 還原（拿掉預設選單）
await (await fetch("/api/admin/line-richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove" }) })).json()
```

- 取得 userId：用那支手機對官方帳號打「我的ID」，機器人只回給本人。
- 分店自己的客人帳號加 `branchId`。沒有自己帳號的分店不能指定（不會落到別家店的帳號）。
- 重新發布會刪掉本系統先前建立的選單；在 LINE 官方後台手動做的選單不會被動到，但「預設選單」只能有一個，發布後以這個為準。
- 換圖：換掉 PNG（同尺寸、格子位置不變）後重新發布。

## AI 客服（客人打字問問題）

預設**關閉**。打開後，客人在聊天室打字（不是訂位代號、也不是付款回報），由 Claude 依店裡的真實資料回答，回覆下方附「我要訂位／我的訂位／看菜單／店家資訊」按鈕。程式：`src/lib/line-ai-assistant.ts`。

- **只回答**：AI 沒有任何工具，不能訂位、改期、取消，也不知道哪個時段有空；它會請客人點「我要訂位」。
- **看得到的資料**：該帳號負責分店的地址、電話、營業時間、公休日、包廂人數與價格、租借須知、取消規則。看不到客人資料、訂位、付款帳號。
- **嚴格模式**：純數字（例如匯款末五碼）、符號、單一個字不算問題，AI 不回，留給店員。
- **上限**：每個官方帳號每天 150 則、每位客人每天 20 則；60 秒內同一句直接回上次答案；超過 500 字不處理。超過上限改回主選單。
- **不給匯款帳號**：「訂金說明」欄位不會給 AI；帳號只在訂位後由系統傳給客人。
- 一次 webhook 最多回一則 AI；模型失敗的那一則也算進每日則數。
- **對話記憶**：最近 6 輪，存 Upstash 30 分鐘後自動消失。客人打的字會送到 Anthropic API。
- **注意**：打開後 AI 會回每一則文字訊息；店員同時在 LINE 後台手動回客人時，客人會收到兩邊的回覆。

| 變數 | 說明 |
|------|------|
| `AI_CS_ENABLED` | `1` = 打開。其他值或沒設 = 關閉 |
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰（console.anthropic.com） |
| `AI_CS_MODEL` | 選填。預設 `claude-opus-5-5`；要省錢可設 `claude-haiku-5-5` |

還需要 `UPSTASH_REDIS_REST_URL`／`UPSTASH_REDIS_REST_TOKEN`（算上限用）；沒設就不會啟用。關閉方式：把 `AI_CS_ENABLED` 拿掉後 Redeploy。

## Flex 卡片（統一版型）

所有營運通知盡量以 **Flex Bubble** 呈現（對齊 DESIGN.md 焦糖品牌色），並附「查看訂位」「開啟官網」等按鈕（類 inline 小站入口）。

| 對象 | 情境 | 建構器 |
|------|------|--------|
| 客人 | 訂金、提醒、候補、綁定、付款回覆 | `src/lib/line-cards.ts` |
| 群組 | 新訂位、付款待審、逾期釋放、改期 | `src/lib/line-cards.ts` |
| 共用版型 | header / rows / CTA | `src/lib/line-flex.ts` → `flexBubble()` |

**仍為純文字**：診斷測試。貓咪彩蛋保留於程式，但排程不再為空檔單獨推播。

Webhook 客人回覆使用 `replyLineFlexMessage`（`src/lib/line.ts`）。

**店內驗收：** 每次 production 部署後跑 [`OPS_LINE_CARD_VALIDATION.md`](./OPS_LINE_CARD_VALIDATION.md)（約 15 分鐘）。

---

## 每日自動提醒

- **時間**：台灣時間每日 20:00（vercel.json cron: `"0 12 * * *"` UTC）
- **Hobby 延遲**：Vercel Hobby **不保證整點準時**，可能在 **20:00–20:59** 之間任一時刻觸發；是否成功請查 `job_runs` 或提醒診斷，不以群組靜默判斷。
- **範圍**：所有已設定 `line_group_id` 的分店（無設定時 fallback `LINE_GROUP_ID`）
- **無待通知訂位時**：不單獨發送貓咪或「皆已通知過」訊息，節省群組推播配額；待通知訂位仍照常提醒。
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
`LINE_USAGE_GUARD_ENABLED=1` 並完成 production quota threshold review。逾期釋放 cron
同一批最多將 5 張群組 Flex 卡放進一次 push request；每筆仍有獨立 delivery claim，失敗
仍寫回各筆 ledger。LINE provider rejection 會保留錯誤狀態、寫入 operational logs，並
由 cron failure handling path escalation。

---

## LINE Login（客人綁定）

用於訂位表單讓客人以 LINE 帳號登入，系統取得其 `userId` 存入 `reservations.line_user_id`，後續通知直接 Push 給本人。

相關 env：`LINE_LOGIN_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET`
Callback URL：`https://sunrise-cafe-six.vercel.app/api/auth/line/callback`
