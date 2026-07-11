# Founder 營運權限清單 — 治理分數路線圖

**目標：** `npm run cto:health` → **Overall 100** · `npm run cto:governance` → **PASS**

**現況（2026-07-11）：** GitHub 已清完（PR 0、幽靈分支已刪）。分數卡在 **production deploy** 與 **OUTCOME_LOG 未測量**。

---

## 分數怎麼算（加權）

| 維度 | 權重 | 現在約 | 滿分條件 |
|------|-----:|-------:|----------|
| Production stability | 25% | ~70 | prod SHA = main + health OK + CI 綠 |
| Security | 20% | 100 | 已滿 |
| GitHub governance | 10% | 100 | 已滿（本輪清完） |
| Product quality | 15% | ~95 | IMPLEMENTATION_TRUTH ✅ 全綠 |
| Customer experience | 15% | **40** | **OUTCOME_LOG 有證據** |
| Revenue reliability | 10% | **35** | **OUTCOME_LOG 有證據** |
| Developer experience | 5% | ~85 | CI 綠 + 測試 ≥100 |

**要衝 100，必須同時：** 部署 production + 填 OUTCOME_LOG（訂金率、migration 等）。

---

## 請開給 Agent / 自動化的權限（依優先序）

### P0 — 不加這些到不了 90 分

| # | 權限 / Secret | 設定位置 | 開了能加多少分 | 怎麼設定 |
|---|---------------|----------|----------------|----------|
| 1 | **Production deploy** | Vercel | **+7～10**（SHA parity） | Dashboard → Deploy 最新 `main`，或 Settings → 新增 `VERCEL_TOKEN` 給 Cloud Agent / GHA |
| 2 | **`CTO_OUTCOME_SECRET`** | Vercel **+** GitHub Actions | **+15～20**（CX + REV） | 自訂隨機字串；Vercel 環境變數 + repo Secrets；啟用 `cto:outcomes` 自動寫入 `OUTCOME_LOG.md` |
| 3 | **Supabase migrations** | Supabase Dashboard | **+5～8**（outcome 欄位 `migrations_all_applied`) | 依 [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md) 執行 3 支 migration（#95） |

### P1 — 自動化與穩定性

| # | 權限 / Secret | 設定位置 | 效果 |
|---|---------------|----------|------|
| 4 | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions Secrets |  live DB drift gate、outcome pipeline 在 CI 跑 |
| 5 | **Upstash Redis** | Vercel 環境變數 | Rate limit 強制生效（CG-006），安全分維持 |
| 6 | `E2E_ADMIN_PASSWORD` | GitHub Actions Secrets | 後台 Playwright 回歸（與 `ADMIN_PASSWORD` 相同即可） |
| 7 | **Allow GHA to create PRs** | GitHub → Settings → Actions → Workflow permissions | 自主迴圈可自動開 PR merge |

### P2 — 可選

| # | 項目 | 說明 |
|---|------|------|
| 8 | `workflow_dispatch` 給 integration | 或手動跑 `gh workflow run github-hygiene.yml` |
| 9 | Vercel Pro / 解除 build rate limit | 避免 PR check 被 Vercel 擋住 |

---

## 最快路徑到 100（約 30 分鐘 Founder 時間）

```bash
# 1. Deploy production（二選一）
cd /path/to/sunrise-cafe && npx vercel deploy --prod
# 或在 Vercel Dashboard 點 Promote latest main

# 2. Supabase SQL（Dashboard → SQL Editor，依 runbook 貼上 3 支 migration）

# 3. Vercel 環境變數
#    CTO_OUTCOME_SECRET=<隨機 32+ 字元>
#    UPSTASH_REDIS_REST_URL=...
#    UPSTASH_REDIS_REST_TOKEN=...

# 4. GitHub → Settings → Secrets → Actions
#    CTO_OUTCOME_SECRET（同 Vercel）
#    E2E_ADMIN_PASSWORD（同 ADMIN_PASSWORD）
#    NEXT_PUBLIC_SUPABASE_URL
#    SUPABASE_SERVICE_ROLE_KEY

# 5. 觸發 outcome 同步（deploy 後）
# 本地：
export CTO_OUTCOME_SECRET=...
npm run cto:outcomes
# 或等 business-intelligence workflow cron

# 6. 驗證
curl -s https://sunrise-cafe-six.vercel.app/api/version   # commit 應 = main
npm run cto:health    # Overall 應 ≥ 90
npm run cto:governance  # Gate PASS
```

---

## Issue 清理狀態（Agent 已處理）

| # | 狀態 |
|---|------|
| 59, 62, 60 | ✅ 已關（github-hygiene workflow） |
| 70–77, 89–91, 112 | ✅ PR 已關 |
| 53, 54, 95, 99 | **保留** — 產品 / 營運史詩，需商業決策 |
| 61, 63 | **保留 P3** — 已登記 `CAPABILITY_GAPS.md`，非阻塞 |

若要進一步精簡 backlog，可關 #61/#63 並註解「改追蹤 CAPABILITY_GAPS CG-xxx」。

---

## 你說「給權限、用 MCP 接上去」— 實話

**此 Cloud Agent 環境只有 `cursor-cloud` MCP**（診斷用），**沒有** Vercel / Supabase / GitHub Secrets 的 MCP。

| 想做什麼 | Agent 能否代設 | 正確做法 |
|----------|:-------------:|----------|
| Vercel 環境變數 | ❌ | 你在 Vercel Dashboard 設，或把 `VERCEL_TOKEN` 貼到 **Cursor Secrets** |
| GitHub Actions Secrets | ❌ | `github.com` → repo → Settings → Secrets（integration token 403） |
| Supabase migration | ❌ | 你在 Supabase SQL Editor 執行 runbook |
| Agent 執行 deploy / outcome 同步 | ✅ | **你把 secret 貼進 Cursor 後，下一輪 agent 自動讀環境變數** |

### Cursor 貼 Secret 的 UI（約 2 分鐘）

1. 打開 [cursor.com/dashboard/cloud-agents](https://cursor.com/dashboard/cloud-agents)
2. **Secrets** 分頁
3. 類型選 **Runtime Secret**
4. 依下表新增 key/value

驗證 agent 是否讀到：`npm run cto:verify-permissions`

若只想開 **3 樣** 就讓 Agent 繼續自治並衝高分：

1. **`VERCEL_TOKEN`**（或每次幫按 production deploy）
2. **`CTO_OUTCOME_SECRET`**（Vercel + GHA）
3. **Supabase migration 執行權**（Dashboard 或 service role 給我們跑 runbook）

其餘我可以繼續用現有管道（ManagePullRequest 關 PR、GHA 關 issue、push 分支）。

---

_每次治理跑完會更新 [`FOUNDER_ACTION_LIST.md`](./FOUNDER_ACTION_LIST.md) 動態快照；本檔為 SSOT，不會被覆寫。_
