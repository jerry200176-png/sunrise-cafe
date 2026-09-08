# Runbook — 操作手冊

## 開發與部署流程（Standard Workflow）

`main` 分支已啟用保護規則，CI 通過才能合併。

```bash
# 1. 從 main 開新分支
git checkout main && git pull
git checkout -b feat/your-feature   # 或 fix/、chore/

# 2. 開發、commit
git add <檔案>
git commit -m "feat: 說明"
git push -u origin feat/your-feature

# 3. 開 PR → CI 自動跑 Lint + Build
#    Vercel 自動產生 Preview URL，可先在 Preview 測試
gh pr create --title "feat: ..." --body "..."

# 4. CI 通過、功能確認後合併 PR
gh pr merge <PR號> --squash

# 5. main 合併後由唯一 production deploy owner 部署正式環境
#    ⚠️ 合併後務必確認 /api/version 的 commit 與 main HEAD 一致（見下方「合併但未上線」）
```

**每個 PR 都有專屬 Preview URL**（格式：`https://sunrise-cafe-xxxxx.vercel.app`），可在正式部署前完整測試。

### 部署責任與 Vercel 配額

- `Production deploy and migrate` 是唯一會從 GitHub Actions 啟動 production deploy 的 workflow，並以 concurrency group 序列化。
- `Verify Production` 只讀取 `/api/version`、health 與 migration drift；它不會 deploy、不會 retry deploy，也不會寫 production 資料。
- Pull request preview 與只改文件／治理／workflow 的 commit 由 `scripts/vercel-ignored-build.sh` 跳過，避免消耗 Vercel build quota。
- 同一個 GitHub repository 綁定多個 Vercel project 是帳號層級問題；請依 [Vercel deployment-cap checklist](./ops/VERCEL_DEPLOYMENT_CAP_CHECKLIST.md) 清理，勿以升級方案取代清理。

### 合併但未上線（Merged ≠ Deployed）

若 PR 已合併但 production 仍是舊 SHA：

```bash
curl -s https://sunrise-cafe-six.vercel.app/api/version
# commit 應等於 git rev-parse origin/main
```

**手動恢復（Founder / 有 Vercel 權限者）：**

```bash
git checkout main && git pull
vercel deploy --prod --yes
```

詳見 [docs/incidents/2026-07-09-vercel-merge-deploy-gap.md](./incidents/2026-07-09-vercel-merge-deploy-gap.md)。

GitHub Actions `verify-production` workflow 會在 push 到 `main` 後輪詢 `/api/version`（逾時則 CI 失敗）。

## 更新環境變數

```bash
# 用 CLI 更新單一變數
vercel env rm VARIABLE_NAME production --yes
echo "new_value" | vercel env add VARIABLE_NAME production

# 更新後必須 Redeploy
vercel --prod
```

---

## 常見問題排查

### 網站連不到資料庫

**原因**：Supabase 免費方案閒置 7 天會暫停。

**解法**：登入 [supabase.com](https://supabase.com) → 點專案 → 按 Restore。

---

### LINE 群組沒收到提醒

1. 檢查 token 狀態：`GET https://sunrise-cafe-six.vercel.app/api/admin/diagnose-line`
2. 確認 Bot 還在群組裡
3. 確認 Vercel 環境變數是最新的（Deployments 頁看最後部署時間）
4. 手動觸發測試：`GET /api/admin/test-line-group`

---

### 客人付款訊息沒有觸發自動標記

1. 確認客人有透過 LINE Login 綁定（訂位的 `line_user_id` 不能是 null）
2. 確認付款關鍵字有包含客人傳的詞（後台 → 設定 → 付款關鍵字）
3. 確認 Webhook 連線正常：LINE Developers → Messaging API → 按 Verify

---

### Build 失敗

```bash
# 本機先跑
npm run build

# 看 ESLint 錯誤修完再 push
npm run lint
```

---

## 新增包廂 / 修改定價

直接到 Supabase Dashboard → Table Editor → `rooms` 表操作，無需改程式碼。

欄位說明：
- `price_weekday`：平日每小時單價
- `price_weekend`：假日每小時單價
- `min_hours`：最少訂位時數（預設 2）

---

## 新增資料庫欄位

1. 在 `supabase/` 寫新的 `migration-*.sql`
2. 到 Supabase Dashboard → SQL Editor 執行
3. 更新 `src/types/index.ts` 的 TypeScript 型別
4. commit 並 push

---

## 換 LINE 官方帳號

詳見 [docs/LINE.md](./LINE.md)。

---

## 回滾版本

```bash
# 到 Vercel Dashboard → Deployments
# 找到上一個成功的 deployment → 右側 ... → Promote to Production
```

或用 CLI：
```bash
vercel rollback
```

---

## payment_events Migration（Phase 0 — 部署必做）

程式已部署但 **資料庫表需手動建立**。未執行前，LINE 截圖付款會 fail-safe（不會誤標已付）。

### 執行步驟

1. Supabase Dashboard → **SQL Editor**
2. 貼上並執行整份 `supabase/migration-payment-events.sql`
3. 驗證：

```bash
# 已登入後台 session 時
curl -s https://sunrise-cafe-six.vercel.app/api/admin/payments/migration-status \
  -H "Cookie: admin_session=..."
# 預期：{"payment_events_ready":true,...}
```

或後台開啟 `/admin/payments`，頂部不應出現 migration 警告。

### RLS 預期

- `anon` / `authenticated`：**無** SELECT/INSERT 權限
- `service_role`：完整存取（Webhook、後台 API）

### 驗證截圖流程

1. 客人 LINE 傳截圖 → `payment_events.status = pending_review`
2. `reservations.is_deposit_paid` **仍為 false**
3. 群組收到「📷 付款截圖待確認」
4. 後台 `/admin/payments` 核准 → `is_deposit_paid = true`

### #55 訂金 Cron 營運檢視

`GET /api/admin/payments/reconcile`（GET 部分）列出 **未付訂金且可能被 Cron 釋放** 的訂位，**不會自動取消**。

每日 20:00（台灣）Cron 會對 `pending` + `confirmed` 且未付訂金者執行到期釋放。部署 #55 前請先檢視此清單並手動處理歷史訂位。

---

## 付款審核後台（#56）

路徑：`/admin/payments`

| 動作 | API | 結果 |
|------|-----|------|
| 列表 | `GET /api/admin/payments/pending` | 待審核 `payment_events` |
| 核准 | `POST /api/admin/payments/:id/approve` | `is_deposit_paid=true`、事件 `approved`、群組通知 |
| 駁回 | `POST /api/admin/payments/:id/reject` | 事件 `rejected` + `review_note` |

重複截圖：同一訂位已有 `pending_review` 時，Webhook 跳過重複 insert。

結構化日誌：Vercel Logs 搜尋 `"domain":"payment"`。

---

## 訂金已確認 LINE 通知人工對帳（>24h Ambiguity Reconciliation）

### 觸發背景
當訂金被核准時，系統會為 LINE 推播產生一組唯一的 `X-Line-Retry-Key` 並在 24 小時內重試。
若遭遇 LINE 服務異常或網路連線中斷超過 24 小時，因 LINE 伺服器僅保留 key 24 小時，系統會主動停止自動重發（防止 duplicate push），發送群組告警並記錄 `ops_events`（`payment.approved_notification_reconciliation_required`）。

告警訊息範例：
```text
⚠️【LINE 訂金通知需人工對帳】
訂位編號：ABC1234
顧客姓名：王小明
原因：LINE 24小時重試窗口已過期，可能曾嘗試推播，已停止自動補送以防重複通知。
請執行對帳確認 LINE OA / 群組推播記錄：
• 已送出：scripts/reconcile-payment-notification.mjs <res_id> --mark-sent
• 確認未送出：scripts/reconcile-payment-notification.mjs <res_id> --safe-retry
```

### Operator 查證步驟（Evidence Verification）

在執行任何對帳操作前，操作員**必須**查證以下兩項事證：

1. **查證 LINE 員工群組（Staff Group）**：
   - 在 Sunrise 員工 LINE 群組內搜尋該「訂位編號」或「顧客姓名」。
   - 確認是否曾出現「💰 客人已付訂金：...」的通知。
2. **查證 LINE 官方帳號後台（LINE OA Manager）**：
   - 若該訂位有綁定 LINE 帳號（`line_user_id` 非空）：登入 [LINE Official Account Manager](https://manager.line.biz/)。
   - 進入「一對一聊天」搜尋顧客姓名，確認對話視窗內是否已送達「訂金已確認」Flex 訊息卡片。

### 選擇操作指令

查證完成後，根據客觀事證執行對應指令（**嚴禁直接在資料庫修改 retry key 欄位**）：

| 查證結果 | 決策 | 執行指令 | 系統行為 |
|---|---|---|---|
| LINE OA 或群組**已有**送達紀錄 | 標記已送達，不再補送 | `node scripts/reconcile-payment-notification.mjs <reservation_id> --mark-sent` | 驗證待對帳狀態，原子更新 `deposit_approved_notified_at`，不呼叫 LINE API，寫入 `ops_events` 審計日誌。 |
| LINE OA 與群組**皆無**任何送達紀錄 | 確認未送出，安全補送 | `node scripts/reconcile-payment-notification.mjs <reservation_id> --safe-retry` | 驗證待對帳狀態，以 `evidenceNoProviderAttempt=true` 調用既有通知路徑，產生安全全新 retry key 派送推播，寫入 `ops_events` 審計日誌。 |

*註：指令支援 `--dry-run` 供事前檢查狀態，亦會 fail-closed 拒絕處理非待對帳（如未付訂、已標記完成、或仍處於 24 小時窗口內）的訂位。*

---

## 系統監控

- **Vercel Logs**：Dashboard → 專案 → Logs（即時 serverless function log）
- **Supabase**：Dashboard → Logs → API / Database
- **LINE token 用量**：`GET /api/admin/diagnose-line`（含本月訊息用量）
