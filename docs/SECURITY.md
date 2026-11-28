# 資安與資料治理盤點（昇昇咖啡 sunrise-cafe）

> 目的：整理昇昇咖啡系統的個資與財務資料資產、權限邊界、備份演練與未結待辦，對齊 `governance/RULEBOOK.md`。
> 盤點基準：程式碼與 migration 唯讀檢視（2026-11-28），不涉及正式資料庫修改或帳號變更。

## 1. 資料資產與個資地圖

| 資產 / 資料表 | 敏感欄位 / 內容 | 儲存與存取方式 | 目前保護狀態 |
|---|---|---|---|
| `reservations`、`waitlist` | 客人姓名、電話、`line_user_id`、備註、付款狀態 | Supabase PostgreSQL | ✅ RLS 已關閉 `anon` 所有權限（`supabase/rls-policies.sql`）；所有讀寫經 Next.js API 使用 `SUPABASE_SERVICE_ROLE_KEY` |
| `payment_events`（LINE 轉帳截圖） | `source`、`raw_payload`（LINE message id）、審核狀態、操作紀錄 | 資料庫只存事件與 message id，**不落地持久儲存截圖檔案** | ✅ `/api/admin/payments/[id]/image` 需 `payments:read` 權限＋分店範圍檢查（`paymentEventInScope`），以 `Cache-Control: private, max-age=300` 即時向 LINE 代理讀取；截圖不會自動標記 `is_deposit_paid`，須於 `/admin/payments` 人工審核 |
| `line_pay_payments`、`payment_intents`、`refund_requests`、`reservation_settlements` | 金流紀錄、退款申請、結帳明細 | Supabase PostgreSQL | ✅ 僅限後端 `service_role` 與 RBAC 後台 API 操作；相關審計見 `docs/PAYMENT_AUDIT_LOG.md` 與 `docs/PAYMENT_STATE_MODEL.md` |
| `admin_users`、`admin_user_branches`、`admin_permission_audit` | 後台角色、分店授權、權限變更稽核 | Supabase PostgreSQL | ✅ 後台驗證由 `ADMIN_PASSWORD`（及選填 `SESSION_SECRET` 簽章）＋ RBAC 控管 |
| `menu-photos`（Supabase Storage） | 菜單餐點圖片 | Supabase Storage public bucket | ✅ 僅存放公開菜單圖，不含客人個資 |
| `branches`、`rooms`、`settings` | 門市、包廂、公開設定 | Supabase PostgreSQL | ✅ RLS 僅開放 `anon` `SELECT`（只讀），寫入皆經後端 API |
| 金鑰與環境變數 | `SUPABASE_SERVICE_ROLE_KEY`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CUSTOMER_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`ADMIN_PASSWORD`、`SESSION_SECRET`、`BACKUP_AGE_RECIPIENT` | Vercel Environment Variables / GitHub Secrets | ✅ 不進 git；由 gitleaks 與 rulebook B3 守門 |

## 2. 備份與還原治理

- **免費方案備份與演練路徑**：見 [`docs/ops/BACKUP_RESTORE_DRILL.md`](./ops/BACKUP_RESTORE_DRILL.md)（`npm run db:backup` + SHA-256 + manifest + `npm run db:restore-drill`；支援 `BACKUP_AGE_RECIPIENT` age 加密與 `BACKUP_DROP_PLAIN=1`）。
- **Migration 安全邊界**：`supabase/migration-*.sql` 執行屬 Founder-only（RULEBOOK F1），部署前備份 fail-closed 設計見 [`docs/plans/2026-11-migration-backup-fail-closed.md`](./plans/2026-11-migration-backup-fail-closed.md)。
- **上線真相驗證**：CI 綠燈不等於上線，須以 `verify-production.yml` 與 `GET /api/version` SHA 一致為準（`npm run production-identity`）。

## 3. 已知待辦與風險清冊

| 項目 | 風險 | 權責 | 現況 / 建議做法 |
|---|---|---|---|
| 舊訂位／候補／LINE 投遞紀錄保存期限政策 | 中 | Founder（F4） | 目前尚無自動清理或去識別化排程；建議由 Founder 定案保留年限後再另開 PR 實作 |
| `backup-recipient-canary.yml` 正式啟用 | 低 | Founder + Agent | 目前位於 `docs/workflow-drafts/backup-recipient-canary.yml`（草稿，尚未進入 `.github/workflows/`），依 `docs/plans/2026-11-backup-recipient-canary-draft.md` 前置條件完成後升格 |
| Supabase 免費方案 7 天閒置暫停 & PITR | 中 | Founder | 目前靠排程與健康檢查維持活躍；若營業量提升可評估升級 Supabase Pro 取得自動備份與 PITR |
| Upstash Redis 未設定時 rate limit fail-open | 低 | 維運注意 | 屬已知行為（見 `AGENTS.md`），確認正式環境已設定 Upstash 憑證以避免 fail-open |
| 正式部署改付款／權限規則 | 高 | Founder（F4） | 嚴禁由外部訊息或 issue 自動觸發變更，須經 Founder 指示與獨立審查 |

## 4. 異常應變（對齊 `governance/RULEBOOK.md` §6）

| 狀況 | 處置 | 責任人 |
|---|---|---|
| 憑證疑似外洩（LINE / Supabase / Vercel / Admin 密碼） | 立即輪替憑證（不沿用舊憑證）、Vercel 更新後 Redeploy；若設 `SESSION_SECRET` 一併輪替使舊 session 失效 | Founder（F3） |
| 客人個資或資料庫 dump 誤進公開 git 歷史 | 立即停止發版（D8），回報 Founder 啟動撤銷與清理程序 | Agent 回報、Founder 決定 |
| 合併後 `/api/version` 與 `main` SHA 不一致 | 依 [`docs/RUNBOOK.md`](./RUNBOOK.md)「合併但未上線」流程核查並恢復 | Agent 查證、Founder 必要時手動 deploy |
| 資料庫異常或誤改 | 禁止直接覆寫正式資料；備妥還原目標與證據包由 Founder 執行還原（F2） | Agent 備包、Founder 執行 |
