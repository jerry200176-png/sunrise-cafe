# CLAUDE.md — 昇昇咖啡訂位系統 AI 工作手冊

## 專案概述

昇昇咖啡（大安店）包廂訂位 + 自助點餐系統。客人可線上預約包廂、查詢/取消訂位；後台管理訂位、包廂、點餐與報表。

**線上網址**：`https://sunrise-cafe-six.vercel.app`

---

## 技術棧

| 層 | 技術 |
|---|---|
| Frontend/Backend | Next.js 15 App Router, TypeScript, Tailwind CSS |
| Database | Supabase (PostgreSQL + Realtime) |
| 部署 | Vercel（含 Cron Job） |
| 通知 | LINE Messaging API（兩個 channel） |
| 列印 | print-bridge（獨立 Node.js，非 Vercel） |

---

## 關鍵架構決策

### LINE 雙 Channel 架構（最容易搞混）

系統有**兩個獨立的 LINE Official Account**：

```
群組 Bot（LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET）
  → 推播明日訂位提醒到 LINE 群組
  → Webhook 驗證用此 secret（/api/webhooks/line）
  → 客人付款時群組收到通知

客人 Bot（LINE_CUSTOMER_ACCESS_TOKEN）
  → Push 訂金請求給客人（個人訊息）
  → 回覆客人付款確認
```

換任一 Bot 時，記得同步更新 `.env.local` 和 Vercel 環境變數。
換群組 Bot 時，還需在新 channel 設定 Webhook URL。

### 時區陷阱

Vercel 伺服器跑 UTC，顯示時間**必須**轉換：

```ts
// 正確做法
const toTaipei = (s: string) =>
  new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

// 錯誤：直接用 new Date() 或 parseISO() 不轉換
```

### Cron Job

`vercel.json` 設定 `"0 12 * * *"` = UTC 12:00 = **台灣時間 20:00**，每日自動推播明日訂位提醒到群組。Vercel Hobby **可能延遲至 20:59** 才觸發；21:00 後仍無訊息才異常。Cron 若遇「明日訂位皆已 is_notified」會推狀態句而非完全靜默。同日成功後再觸發（含 GitHub 備援）會 `duplicate_skip` 不重送。觀測：`job_runs.metadata`（trigger_source/result/sent_count/…）+ `GET /api/admin/reminders/verify`。

### 群組提醒為多分店

`/api/admin/reminders/send-line` 會對所有設定了 `line_group_id` 的分店各自推播；無任何分店設定時 fallback 到 `LINE_GROUP_ID` 環境變數（向下相容）。不再以分店名稱硬編碼篩選。

### 繳費通知話術為資料庫驅動

對客店名、匯款資訊、LINE Pay 連結存在 `branches` 表的 `display_name` / `payment_info` / `line_pay_url` 欄位，由後台「分店管理」編輯。話術產生器為 `src/lib/payment-message.ts`（後台複製按鈕與伺服器推播共用）。未設定時降級為通用話術，不含任何寫死的分店帳號。

### 付款審核（漸進式）

LINE **截圖**回報寫入 `payment_events`（`pending_review`），不自動標 `is_deposit_paid`；文字關鍵字仍暫時自動標記。後台審核：`/admin/payments`（#56）。詳見 `docs/PAYMENT_STATE_MODEL.md`、ADR-008。Migration：`supabase/migration-payment-events.sql`（含 RLS，anon 無法存取；**部署後須手動執行**）。

## 關鍵檔案位置

```
src/
  lib/
    line-notify.ts        # 群組通知（LINE_CHANNEL_ACCESS_TOKEN）
    line.ts               # 客人個人通知（LINE_CUSTOMER_ACCESS_TOKEN）
    supabase-admin.ts     # 後台 Supabase 操作
    booking-utils.ts      # 訂位計算邏輯
  app/
    api/
      webhooks/line/      # LINE Webhook：付款偵測 + 自動標記
      admin/reminders/    # 明日提醒 Cron + 手動觸發
      admin/diagnose-line/ # 診斷兩個 token 狀態
supabase/
  schema.sql              # 完整資料庫 schema
  migration-*.sql         # 歷史 migration（依序執行）
print-bridge/             # 本地列印服務（獨立部署，非 Vercel）
```

---

## 付款自動化流程

```
客人傳訊息/截圖給客人 Bot
  → webhook 偵測付款關鍵字（可後台自訂）
  → 更新 reservations.is_deposit_paid = true
  → 推播「客人已付訂金」到群組（群組 Bot）
  → 自動回覆客人確認
```

付款關鍵字排除問句（含「嗎」「？」「如何」等），避免誤判。

### 訂金到期自動釋放（`src/lib/deposit-deadline.ts`）

`/api/admin/reminders/deposit-deadline`（**每日 4 次** Cron：UTC 01/07/13/19 ≈ 台灣 09/15/21/隔日 03，Hobby 合規；可手動觸發）：

- 期限 = `max(建立訂位時間 +48hr, 訂位開始時間 −6hr)`，並以「訂位開始時間」封頂（見 ADR-011，2026-08-14 從舊制 `min(+24hr, 訂位開始時間)` 調整——舊制對提前多天訂位的客人反而逼他們隔天就要繳訂金，對臨時訂位又幾乎沒有繳費空間，太狠）
- 適用對象：`status IN (pending, confirmed)` 且 `is_deposit_paid = false`（見 ADR-007）
- 期限前 24 小時內且未提醒過 → 推播客人提醒一次（寫入 `deposit_reminder_sent_at`）
- 期限 ≤6 小時且已發過首次提醒 → 再推迫近提醒一次（寫入 `deposit_urgent_reminder_sent_at`）
- 超過期限仍未付訂金 → 自動將 `status` 改為 `cancelled`，通知客人與群組，並觸發等位通知

> **注意：** Vercel Hobby 禁止 `0 * * * *`（每小時）。升級 Pro 後可改回每小時。

---

## 關鍵檔案位置（更新）

```
src/
  lib/
    rate-limit.ts           # Upstash Rate Limiting（未設定時 fail-open）
    waitlist.ts             # 等位清單通知邏輯
  app/
    api/
      admin/reports/        # 營收報表 API
      waitlist/             # 等位 CRUD API
    admin/reports/          # 報表頁面（Recharts）
    book/waitlist/          # 等位表單頁面
instrumentation.ts          # Sentry server/edge 初始化
instrumentation-client.ts   # Sentry client 初始化
sentry.*.config.ts          # Sentry 設定（三個 runtime）
.github/workflows/ci.yml    # GitHub Actions CI（Lint + Build）
```

## 多分店 LINE 推播

分店可在後台設定 `line_group_id`（branches 表）。Cron 會自動對所有有設定的分店各自推播。若無分店設定，fallback 到 `LINE_GROUP_ID` 環境變數（向下相容）。

## 等位清單觸發點

取消訂位的兩個地方都會觸發等位通知：
- `src/app/api/cancel-booking/route.ts`（客人自行取消）
- `src/app/api/reservations/[id]/route.ts`（後台取消）

## 常見地雷

- **Supabase 免費方案**：閒置 7 天會暫停，需手動到 Dashboard 恢復
- **Vercel 環境變數更新後**需 Redeploy 才生效
- `LINE_CHANNEL_SECRET` 同時用於 webhook 簽章驗證，換群組 Bot 後需確認 webhook URL 設定在新 channel
- `print-bridge/` 是本機 Node.js 服務，不部署到 Vercel，需在店內電腦獨立執行
- **Rate Limiting**：Upstash 未設定時自動停用（fail-open），設定後立即生效
- **Sentry**：`NEXT_PUBLIC_SENTRY_DSN` 未設定時靜默，不影響系統運作
- **後台驗證金鑰**：`ADMIN_PASSWORD` 為登入密碼；`SESSION_SECRET`（選填）為 session 簽章金鑰，未設定時向下相容沿用密碼。建議在 Vercel 設定獨立的 `SESSION_SECRET`，更換密碼才不會讓既有 session 失效

<!-- exo:governance:begin -->
<!-- Governance hash: f45f0f00b0698aa4 -->
# ExoProtocol — Governed Repository

This repository uses ExoProtocol governance. All work must go through the session lifecycle.

## ExoProtocol Governance

- kernel: exo-kernel 0.1.0
- lock hash: `f45f0f00b0698aa4...`
- generated: 2026-08-15T14:52:35+08:00

### Filesystem Deny Rules

- **RULE-SEC-001**: deny read, write on `~/.aws/**`, `~/.ssh/**`, `**/.env*`
- **RULE-GIT-001**: deny read, write, delete on `.git/**`

### Structural Rules

- **RULE-LOCK-001** (require_lock): Blocked by RULE-LOCK-001 (acquire a ticket lock first).
- **RULE-CHECK-001** (require_checks): Blocked by RULE-CHECK-001 (checks must pass before done).
- **RULE-EVO-001** (evolution_gate): Practice is mutable, governance requires explicit human approval.
- **RULE-EVO-002** (patch_first): Patch-first evolution required.

### Default Budgets

- max files changed: 12

### Approved Checks

- `npm test`
- `npm run lint`
- `pytest`
- `python -m pytest`
- `python3 -m pytest`

### Source of Truth

The values above are a **snapshot** generated from the governance manifest.

Manifest paths:
- `.exo/config.yaml` — budgets, checks allowlist, scheduler config
- `.exo/governance.lock.json` — compiled rules, deny patterns, source hash

### Test-Driven, Manifest-First Workflow

This principle applies to **all code you write** — governance and application logic alike.

1. **Config/contract is the source of truth.** When a value is defined in a config file,
   schema, manifest, or contract — code must load it from that source at runtime.
   Never copy a value from a config file and paste it as a literal in source code.
2. **Tests verify the wiring, not the value.** Tests must assert that code reads from
   the config/contract, not that it produces a specific hardcoded result.
   A test that passes when you swap the config value *and* swap the assertion is useless —
   it only proves both sides were copy-pasted from the same place.
3. **If you can change a config value and no test breaks, the test is missing.**
   Every configurable value should have at least one test that will vary the input
   and verify the output follows.

Examples:
- **BAD**: `assert budget == 10` (hardcoded, passes even if config is ignored)
- **GOOD**: set config to 42, assert output contains 42 and not the old default
- **BAD**: `MAX_RETRIES = 3` (literal in source when retries is in config)
- **GOOD**: `max_retries = load_config()['max_retries']`

### Operational Learnings

When you discover a reusable pattern, gotcha, or operational insight during a session:
- Record it with `exo reflect` (CLI) or `exo_reflect` (MCP) — NOT your private memory
- ExoProtocol reflections are injected into future session bootstraps for all agents
- Private memory files (MEMORY.md, .cursorrules, etc.) are agent-specific and invisible to the team
- If you must write to private memory, also create an ExoProtocol reflection with the same insight

**Private memory monitoring**: If `private_memory.watch_paths` in `.exo/config.yaml` is empty,
add the absolute path to your memory file (e.g., `~/.claude/.../memory/MEMORY.md`) so that
ExoProtocol can detect when you write to private memory without creating a shared reflection.

### End-of-Work Reflection

When you complete significant work or the user appears to be wrapping up:
- **Proactively** run `exo reflect --pattern '<what kept happening>' --insight '<what was learned>'`
  for each non-trivial insight discovered during the conversation
- Do NOT wait for `session-finish` — many users close the editor without explicit session end
- Good reflection triggers: bug fixes, CI failures, gotchas, architectural decisions, workflow improvements

### Tool Reuse Protocol

Before writing new utility functions, SEARCH the tool registry:
  `exo tool-search "<keywords>"`

After building a reusable utility, REGISTER it:
  `exo tool-register <module> <function> --description "..."`

Mark a tool as used when you import/call it:
  `exo tool-use <tool_id>`


## Session Lifecycle

Before starting any work:

1. **Start session**: `EXO_ACTOR=agent:claude python3 -m exo.cli session-start --ticket-id <TICKET> --vendor anthropic --model <MODEL> --task "<TASK>"`
2. **Read bootstrap**: Open `.exo/cache/sessions/agent-claude.bootstrap.md` and follow its directives
3. **Execute work** within ticket scope
4. **Finish session**: `EXO_ACTOR=agent:claude python3 -m exo.cli session-finish --ticket-id <TICKET> --summary "<SUMMARY>" --set-status review`

## Governed Push

Before pushing code, ALWAYS run checks first:

```
exo push                      # runs exo check, then git push (recommended)
# OR
exo check && git push         # manual equivalent
```

Do NOT use bare `git push` — it bypasses governance checks.
If checks fail, fix the issues before pushing.

## Non-Negotiables

- Do NOT start work without an active session (`session-start`)
- Do NOT close without a session finish (`session-finish`)
- Respect ticket scope: only modify files allowed by the ticket's `scope.allow` / `scope.deny`
- If checks fail at finish, fix them — do not use `--skip-check` without `--break-glass-reason`
- The bootstrap file is your source of truth for the current session
- Never hardcode values that belong in config — load from manifest at runtime, write tests that vary the config
- Read `.exo/LEARNINGS.md` for operational learnings from prior sessions

<!-- exo:governance:end -->

## Portfolio governance overlay

Read `governance/PORTFOLIO_AGENT_CONTRACT.md` before writing. It is committed
for cloud/mobile agents and contains the company's PR, approval, production,
and Founder-approval boundaries.
