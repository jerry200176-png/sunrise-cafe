# Changelog

所有重要變更記錄於此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本號遵循 [Semantic Versioning](https://semver.org/)。

---

## [Unreleased]

### Commercial Maturity A — continue (2026-07-15)
- Migrate workflow: **main-only** + summary fails if probes fail; expanded anon PATCH (rooms/settings) + refund/ops_events probes
- CI: `Required gates` job (Lint/Build/Test + Playwright); Vercel Hobby quota explicitly non-gating
- `/admin/today` E2E: hops, pending review, invalid session, mobile no-scroll; prod phone opt-in
- North Star: contract gates (min_n / freshness / reconciliation / duplicates); ops_events idempotency_key
- DR: restore verify queries; Upstash config validation + outage→memory degraded

### Commercial Maturity A — Loop 2 (2026-07-15)
- #213 merged (`f7d81f2`); production deploy blocked by Vercel Hobby daily quota [FACT]
- Fix `migration-ops-events.sql` `schema_migrations.name` (unblocks KPI table apply)
- Maturity migrate workflow Environment name → **`Production`** (case-correct)

### Commercial Maturity A — Loop 1b converge (2026-07-15)
- SSOT 對齊：Evidence／Gaps／CAPABILITY_GAPS；memory rate limit 標為 **degraded**（A 級需 Upstash）
- 受控遷移：`production-maturity-migrate.yml`（Environment `production` + APPLY + preflight/apply/probes，不印 secrets）
- `/admin/today`：分店 ACL、partial errors、Taipei window、task hops、E2E 驗收
- North Star **contracts**（分子／分母／時區／窗／完整度／對帳）暴露於 `/api/admin/north-star`
- Backup：sha256 + manifest + retention + 隔離 restore drill

### Commercial Maturity A — Loop 1 (2026-07-15)
- **Stripe 二元化**：大安 `stripeEnabled=false`；新增 `GET /api/payment/status`；訂位頁僅在 server `stripe_enabled` 時開 Modal（消除 503 半成品入口）
- **Rate limit**：Upstash 未設定時改記憶體 sliding window（production 不再 fail-open）；`/api/booking-health` 回報 `rate_limit_mode`
- **今日場控**：`/admin/today` + `GET /api/admin/today`（時間軸／未付／審核／候補／一鍵撥號）
- **取消／退費模型**：`cancel-refund-policy` + `POST /api/refund-request` + `migration-refund-requests.sql`（不自動退款）
- **Funnel**：擴充 step／submit 事件；E2E mock 改半小時格以修復 CI
- **備份演練**：`npm run db:backup` / `db:restore-drill`；`docs/ops/BACKUP_RESTORE_DRILL.md`
- **Rubric SSOT**：`COMMERCIAL_MATURITY_RUBRIC.md` + frozen baseline + gaps + evidence（整體仍誠實評為未達 A）

### Security — Catalog RLS harden (2026-07-15 audit)
- **後台目錄寫入**改走 `SUPABASE_SERVICE_ROLE_KEY`（branches／rooms／settings／legacy reservation helpers），不再用公開 anon key 突變資料
- 新增 `supabase/migration-rls-catalog-read-only.sql`：anon 僅 SELECT；**部署程式後須在 Supabase 執行**
- `getAdminContext` 在需登入但 session 無效時回傳零權限 `none`，不再誤升為 owner
- `headersAdmin` 缺少 service role 時改為拋錯，禁止靜默降級 anon
- 競爭力審計報告：`docs/internal/executive/COMPETITIVE_AUDIT_2026-07-15.md`

### Guest (CX-006)
- Waitlist confirm page (`/book/waitlist/confirm`): full zh/en/ja i18n + language switcher

### Guest (CX-007)
- Query page (`/book/query`): sticky bottom payment CTA on mobile when deposit unpaid
- Telemetry: `payment_sticky_viewed`, `payment_sticky_line_pay_click`, `payment_sticky_line_official_click`

### Guest (CX-008) — PR #189
- **忘記訂位代號**：客人可透過電話＋訂位日期找回訂位，不需要 6 碼訂位代號。主要驗證仍維持 phone+code，找回功能作為備用方案。
- 同步更新 package-lock.json 以符合 Stripe 依賴完整性。

### Staff (ADM-002)
- Replace `alert()` / `window.prompt()` in `ReservationList` with mobile-friendly toast + prompt dialog
- Cron `job_runs` degrades gracefully when Supabase API key is invalid (CI + misconfigured env)

### Docs — PR #183
- 建立 `docs/git-convention.md` — branch 命名規則 + Conventional Commits 規格
- 建立 `docs/code-review-guide.md` — review 優先級、流程、標準與文化
- 更新 `.github/PULL_REQUEST_TEMPLATE.md` — 全面性 PR 模板（含測試／安全／文件／部署 checklist）

### Payment — Stripe 支付 UI 整合（PR #185）
- **付款流程**：新增 `PaymentForm` + `PaymentModal` Stripe Elements 付款元件
- **API**：`POST /api/payment/create-intent` 建立 Stripe PaymentIntent、`POST /api/payment/confirm-deposit` 確認付款
- **Webhook**：`POST /api/webhooks/stripe` 處理付款成功／失敗／退款事件
- **資料表**：`payment_intents` migration 記錄每筆付款狀態
- **訂位流程**：假日訂位自動彈出付款確認，分店控制（僅大安啟用）

### Payment — Server 端 amount 驗證（B-02）
- **金額防竄改**：在 `POST /api/payment/create-intent` 加入 server 端 amount 驗證，防止客戶端竄改付款金額
- 驗證金額與分店訂金設定一致，不符則拒絕請求
- 與測試案例 `route.test.ts`（158 行）確保覆蓋

### Payment Security (PR #187)
- **Server-side amount validation** on `POST /api/payment/create-intent`: validates `amount` against `getBranchDepositConfig(branchId).defaultDepositAmount` before calling Stripe API (B-02 fix). Prevents client-side payment amount tampering — malicious users can no longer pass arbitrary amounts. Adds 6 test cases covering edge cases (zero, negative, mismatched, unknown branch). 2 files changed (+168/-0). Backward-compatible — frontend unchanged.

---

## [2.2.0] — 2026-07-10 (pending)

### Security — RBAC foundation (Wave 2)
- `admin_users` table + email/password login (legacy `ADMIN_PASSWORD` still works)
- Roles: owner, branch_manager, staff, finance
- `requirePermission()` helper + `/api/admin/me` + user management APIs
- `/admin/users` UI

### Operations
- `docs/ENGINEERING_DASHBOARD.md` — CTO Operating System SSOT
- `docs/IMPLEMENTATION_TRUTH.md` — enforced vs planned capabilities
- `docs/RBAC.md`

**Migration required:** `supabase/migration-phase7-rbac.sql`

### Wave 2b (pending)
- `requirePermission` on all `/api/admin/payments/*` routes

---

## [2.1.0] — 2026-07-10

Shipped via Wave 1 (cherry-pick from phase2, one deployable unit).

### Security

- Guest auth: phone + booking_code required for lookup/cancel/reschedule (closes #67)
- `guestLookup` rate limit (10/min) on guest APIs
- IDOR prevention via `verifyGuestBookingById`

### Reliability
- P1-2 PostgreSQL exclusion constraint for double-booking prevention (ADR-010)
- `SlotConflictError` maps Postgres `23P01` → HTTP 409
- Booking code collision retry (up to 3 attempts)

### Product
- P1-3 Waitlist CTA when rooms/slots unavailable; deep-link prefill on waitlist form

### Correctness
- P1-4 Timezone audit: server pricing uses `isWeekendDate` / `toTaipei` (Asia/Taipei)

### Operations
- P1-5 gitleaks blocking in CI; `schema_migrations` table; `docs/MIGRATIONS.md`
- Booking route `loading.tsx` + `error.tsx`

---

## [RC3-P0] — 2026-07-10

### Security
- Admin auth deny-by-default in production when `ADMIN_PASSWORD` unset (`isAdminAuthRequired`)
- Protect `POST /api/branches`, `POST/PATCH/DELETE /api/rooms`, `POST /api/reservations/recurring`
- `GET /api/diagnose` admin-only
- Guest `POST /api/reservations`: force `status=pending`, server-side `computeReservationTotalPrice`
- `/api/booking-health` public minimal response; detailed diagnostics require admin session

### Added
- `docs/ENGINEERING_ASSESSMENT.md` — principal engineering audit
- `computeReservationTotalPrice()` / `isWeekendDate()` in `booking-utils`

### Tests
- Admin auth production fail-closed, expanded `isAdminOnlyApiPath` coverage, price computation tests

---

## [RC2-P2] — 2026-07-09

### Security
- Admin-only API paths: GET `/api/reservations`, POST `send-line`, POST `recurring/admin`, PATCH/DELETE `branches/[id]`, PATCH `/api/settings`
- `isAdminOnlyApiPath()` middleware expansion

### Operations
- Post-merge `verify-production` GitHub Actions workflow
- Release index, deploy-gap incident record, RUNBOOK recovery section

---

## [RC2-P1] — 2026-07-09

### Security
- `PATCH`/`DELETE` `/api/reservations/[id]` 需 admin session（middleware + handler）
- 新增 `requireAdminApiAuth()` 共用守衛

### Added
- Phase A 付款稽核結構化日誌（`logDepositStatusChange`）
- ADR-009、RC2-P1  release 文件、部署事故紀錄

### Tests
- +17 Vitest（auth、audit log PII guard）

詳見 [docs/releases/RC2-P1.md](./docs/releases/RC2-P1.md)。

---

## [RC1] — 2026-07-09

### Added
- 後台付款審核佇列（`/admin/payments`、`payment_events`）
- 分店驅動客人付款 UI、`payment-log.ts`、CSV 對帳 MVP
- Dependabot、gitleaks、CI `npm audit`、Playwright smoke

### Fixed
- 訂金到期 Cron 涵蓋 `confirmed` 未付款（#55）

詳見 [docs/releases/RC1.md](./docs/releases/RC1.md)。

---

## [1.1.0] — 2026-05-16

### Added
- **Sentry Error Monitoring**：自動捕捉 server/client 錯誤，Session Replay，global-error 友善錯誤頁
- **API Rate Limiting**：Upstash Redis sliding window，分層限流（登入 5/min、訂位 5/min、查詢 30/min）
- **GitHub Actions CI**：PR 自動跑 Lint + Build，main 分支保護規則
- **D-7 客人提醒**：有綁定 LINE 的客人，訂位 7 天前自動收到個人提醒
- **等位清單（Waitlist）**：時段滿時可加入等位，有人取消自動 LINE 通知第一位等位者
- **後台營收報表**：月份趨勢圖（Recharts）、包廂使用率、熱門時段、一鍵匯出 CSV
- **分店 LINE 群組 ID 資料庫設定**：移除硬編碼「大安店」，各分店獨立設定群組 ID，支援多分店

### Fixed
- Supabase 手動備份腳本（PowerShell）+ 每週自動排程設定說明

### Infrastructure
- 完整文件套件：CLAUDE.md、CHANGELOG、ARCHITECTURE、DECISIONS、ENV、GLOSSARY、LINE、RUNBOOK
- PR Template（.github/PULL_REQUEST_TEMPLATE.md）

---

## [1.0.0] — 2026-05-09

### Added
- 付款關鍵字可在後台自訂（預設保留，可新增/刪除）
- 問句自動排除：訊息含「嗎」「？」「如何」等不觸發付款偵測

### Fixed
- LINE 群組通知與客人個人通知時間顯示從 UTC 修正為台灣時間（Asia/Taipei）

---

## [0.9.0] — 2026-04-24

### Added
- 訂位表單加入 LINE Login 綁定，提高通知綁定率
- 客人傳圖片自動視為付款截圖，觸發已付訂金標記
- 後台診斷端點（`/api/admin/diagnose-line`）：查詢兩個 token 狀態與本月用量

### Fixed
- 拆分群組 Bot 與客人 Bot 為獨立 LINE channel（`LINE_CHANNEL_ACCESS_TOKEN` vs `LINE_CUSTOMER_ACCESS_TOKEN`）
- 確認訂位時若無金額，自動從房間定價計算，不再卡關
- 重複電話客人自動繼承已綁定的 `line_user_id`
- 付款偵測改為關鍵字比對，避免一般聊天誤觸發群組通知

### Added（付款自動化）
- 後台一鍵手動發送 LINE 繳費通知按鈕
- 客人付款後系統自動標記 `is_deposit_paid`、群組同步收到通知
- 無訂位時群組自動發送貓咪訊息（隨機 5 則）

---

## [0.8.0] — 2026-04-22

### Added
- 後台公休日設定，前台自動封鎖無法訂位
- 包廂訂位最少 2 小時限制

---

## [0.7.0] — 2026-04-17

### Changed
- 所有訂位（平日/假日）均收取訂金（原僅週末/國定假日）

---

## [0.6.0] — 2026-04-01

### Added
- 自助點餐系統：菜單瀏覽、購物車、訂單送出、QR 桌位牌
- 廚房列印站（Star WebPRNT，58mm 熱感紙）
- `print-bridge` 本機列印橋接服務

---

## [0.5.0] — 2026-03-06

### Added
- 訂金追蹤系統（`is_deposit_paid`）
- 訂位查詢頁面顯示匯款方式說明、截圖上傳引導
- 包廂說明同意勾選框、人數範圍設定

### Changed
- 取消政策更新為 48 小時前可取消並退訂金

---

## [0.4.0] — 2026-02-24

### Added
- LINE 明日訂位自動提醒（每日台灣時間 20:00 推播到群組）
- Vercel Cron Job 設定（`vercel.json`）
- 後台儀表板訂位時間軸視圖，標記已通知狀態

---

## [0.3.0] — 2026-02-10

### Fixed
- 時區問題全面修正（Vercel UTC → Asia/Taipei）
- 時段選項改為 0.5 小時間隔

### Improved
- 後台管理 UX 全面優化
- 包廂圖片顯示修正

---

## [0.2.0] — 2026-02-05

### Added
- LINE 群組通知：新訂位、後台確認後自動推播
- 包廂圖片支援（Supabase Storage）
- 訂位狀態預設為 `pending`（需後台確認）
- `/api/version` 部署確認端點

### Fixed
- Next.js 15.1.9 升級（CVE-2025-66478 安全修補）
- 台灣時區可用時段計算修正

---

## [0.1.0] — 2026-02-05

### Added
- 初始版本：昇昇咖啡包廂訂位系統
- 客人端：選分店/包廂/時段、填資料預約、查詢與取消
- 後台：訂位列表、包廂管理、儀表板
- Supabase PostgreSQL + Realtime
- Vercel 部署
