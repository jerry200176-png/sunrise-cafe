# Runbook — 操作手冊

## 日常部署

```bash
# 本機改完後
git add <檔案>
git commit -m "feat/fix/chore: 說明"
git push

# Vercel 自動觸發重新 build（約 1-2 分鐘）
# 或手動用 CLI
vercel --prod
```

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

## 系統監控

- **Vercel Logs**：Dashboard → 專案 → Logs（即時 serverless function log）
- **Supabase**：Dashboard → Logs → API / Database
- **LINE token 用量**：`GET /api/admin/diagnose-line`（含本月訊息用量）
