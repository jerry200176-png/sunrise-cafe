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

# 5. main 合併後 Vercel 自動部署正式環境
#    ⚠️ 合併後務必確認 /api/version 的 commit 與 main HEAD 一致（見下方「合併但未上線」）
```

**每個 PR 都有專屬 Preview URL**（格式：`https://sunrise-cafe-xxxxx.vercel.app`），可在正式部署前完整測試。

### 合併但未上線（Merged ≠ Deployed）

若 PR 已合併但 production 仍是舊 SHA：

```bash
curl -s https://sunrise-cafe-six.vercel.app/api/version
# commit 應等於 git rev-parse origin/main
```

**手動恢復：**

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

## 系統監控

- **Vercel Logs**：Dashboard → 專案 → Logs（即時 serverless function log）
- **Supabase**：Dashboard → Logs → API / Database
- **LINE token 用量**：`GET /api/admin/diagnose-line`（含本月訊息用量）
