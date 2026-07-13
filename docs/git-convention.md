# Git 分支命名與 Commit 規範

> 版本：v1.0
> 日期：2026-07-13
> 適用：sunrise-cafe 專案

---

## 一、分支命名規範

### 1.1 格式

```
{type}/{description}
```

### 1.2 類型與範例

| 類型 | 前綴 | 範例 |
|------|------|------|
| 新功能 | `feat/` | `feat/stripe-deposit-integration` |
| Bug 修復 | `fix/` | `fix/deposit-deadline-overflow` |
| 技術債 / 重構 | `refactor/` | `refactor/payment-service` |
| 文件 | `docs/` | `docs/api-contract-v1` |
| 測試 | `test/` | `test/payment-webhook` |
| 效能 | `perf/` | `perf/booking-query-optimization` |
| CI/CD | `ci/` | `ci/add-playwright-e2e` |
| 雜務 | `chore/` | `chore/update-dependencies` |

### 1.3 規則

- 全**小寫**英文（可含數字與 `-`）
- 單字間用 `-` 連接
- 描述**精簡**（15 字以內），一眼看出修改範疇
- 從 `main` 分支開出
- 完成後 **squash merge** 回 `main`
- 合併後**刪除遠端分支**

### 1.4 AI Agent 分支

自動化 agent（如 CTO agent、CubeLV CLI）建立的分支使用 `cursor/` 前綴：

```
cursor/{description}-{suffix}
```

範例：`cursor/github-secrets-guide-bb51`

這類分支遵循相同的 squash merge + 刪除規則，由 agent 的 governance 腳本管理。

---

## 二、Commit Message 規範

### 2.1 格式

遵循 **Conventional Commits**：

```
<type>(<scope>): <description>

[optional body]

[optional footer: BREAKING CHANGE / Ref / Closes #issue]
```

- **header** 不得超過 **72 字元**
- **body** 每行不得超過 **100 字元**
- **type** 必填，**scope** 選填但強烈建議

### 2.2 Types

| Type | 使用時機 |
|------|---------|
| `feat` | 新功能 |
| `fix` | Bug 修復 |
| `refactor` | 重構（不修 bug 不加功能） |
| `docs` | 文件 |
| `test` | 測試 |
| `chore` | 雜務（CI、依賴、設定） |
| `perf` | 效能優化 |
| `style` | 格式（空白、逗號、不影響邏輯） |

### 2.3 Scopes（sunrise-cafe 專案）

| Scope | 涵蓋範圍 |
|-------|---------|
| `payment` | 支付相關（Stripe、LINE Pay、訂金） |
| `reservation` | 訂位相關（預約、取消、修改） |
| `admin` | 後台管理（報表、設定、分店） |
| `line-bot` | LINE Bot（雙 channel、webhook、推播） |
| `db` | 資料庫遷移（migration SQL、schema 變更） |
| `ui` | 前端 UI（頁面、元件、路由） |
| `cron` | 排程任務（reminder、deposit-deadline） |
| `infra` | 基礎架構（Vercel、CI/CD、環境設定） |
| `print` | 列印服務（print-bridge） |
| `waitlist` | 等位清單 |

### 2.4 範例

```bash
# 新功能：Stripe PaymentIntent
git commit -m "feat(payment): add Stripe PaymentIntent creation API

Implement POST /api/payment/create-intent that creates a Stripe
PaymentIntent for the given reservation amount. Validates branch
and deposit requirement before proceeding.

Closes #99"

# Bug 修復：時區問題
git commit -m "fix(reservation): correct timezone offset in deposit deadline

The cron was comparing UTC time with local time, causing
early/late cancellations. Now uses Asia/Taipei throughout."

# 重構
git commit -m "refactor(payment): extract deposit deadline logic to shared lib"

# 文件
git commit -m "docs: add git convention and code review guide"
```

---

## 三、PR Title 格式

PR 標題遵循以下格式：

```
[{type}] {簡短描述} (#{issue-number})
```

範例：

| 類型 | PR Title |
|------|---------|
| 新功能 | `[feat] Integrate Stripe payment for deposits (#99)` |
| Bug 修復 | `[fix] Correct timezone offset in deposit deadline (#102)` |
| 文件 | `[docs] Add git convention and code review guide` |
| CI | `[ci] Add Playwright E2E test suite` |

> 無對應 issue 時省略 `(#number)` 部分。

---

## 四、工作流程總結

```text
1. 從 main 開分支（feat/xxx, fix/xxx, docs/xxx, ...）
2. 開發，遵循 Conventional Commits 撰寫 commit message
3. 推送分支到 GitHub
4. 開 PR（使用 .github/PULL_REQUEST_TEMPLATE.md）
5. 指派 Reviewer（至少一名）
6. CI 自動檢查（lint + build + test）
7. Reviewer 審查（24h 內開始，參見 docs/code-review-guide.md）
8. 通過後 Squash Merge 到 main
9. 刪除遠端分支
```

---

## 五、補充說明

### BREAKING CHANGE

當變更破壞向下相容性時，在 footer 標記：

```
feat(payment): redesign deposit flow

BREAKING CHANGE: deposit_deadline field renamed to deposit_due_at
```

這會觸發 major version bump（若使用 semantic-release）。

### 多人協作分支

若多人協作同一分支，使用 `--no-ff` 合併 feature branch 到 main，保留協作歷史。

### AI Agent 注意事項（CLAUDE.md）

- CubeLV CLI 或 CTO agent 建立的分支會自動以 `cubelv-cli-` 或 `cursor/` 為前綴
- Agent 的 commit 也遵守 conventional commits 格式
- Agent 自動處理的 chore / docs 類 PR 應在 PR body 說明由 agent 執行

---

*版本：v1.0 | 最後更新：2026-07-13*