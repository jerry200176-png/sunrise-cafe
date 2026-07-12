# Founder Action List

**Updated:** 2026-07-13 07:00 CST  
**Gate:** PASS（doc drift 0）· Overall **79** / 100  
**SSOT:** [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)

---

## 目前阻塞（自動偵測）

| 項目 | 現況 | 解法 |
|------|------|------|
| Production SHA | ✅ `3bb16dc` = prod | — |
| OUTCOME_LOG | ✅ **已量測** 2026-07-12（訂金率 82.4%） | 每週 `npm run cto:outcomes` 或等 cron |
| DB migrations | ✅ 核心已套用 | 選用：`line_group_id` |
| Gmail 自動掃信 | 🟡 Secrets 未設 | 見下方 **Gmail 兩步設定** |
| 幽靈 PR #152 #154 | 🟡 分支已刪，PR 仍開 | **你點兩下關閉**（見下方） |

## GitHub 狀態（本輪）

| 指標 | 值 |
|------|---:|
| Open PRs | 2（#152 #154 幽靈 — 分支已刪） |
| cursor/* branches | **0**（已清） |
| Bot can close PRs | **no** — 需 Founder 手動關 PR |

### 關閉幽靈 PR（約 10 秒，Agent 無權限代關）

分支已刪，直接關 PR 即可：

- https://github.com/jerry200176-png/sunrise-cafe/pull/152 → Close pull request
- https://github.com/jerry200176-png/sunrise-cafe/pull/154 → Close pull request

---

## Gmail 兩步設定（讓 Agent 幫你掃信）

1. **Google** → [應用程式密碼](https://myaccount.google.com/apppasswords) → 產生一組（郵件 / 其他裝置）
2. **Cursor** → [Cloud Agent 環境 Secrets](https://cursor.com/dashboard/cloud-agents/environments/r/github.com/jerry200176-png/sunrise-cafe) → 新增：
   - `GMAIL_USER` = 你的 Gmail
   - `GMAIL_APP_PASSWORD` = 剛產生的 16 碼

設好後在對話說「掃 Gmail」，Agent 會跑 `npm run gmail:scan` 並整理 Vercel/GitHub 失敗信。

詳見 [`ENV.md`](./ENV.md) § Gmail。

---

## 一鍵指令

```bash
npm run cto:outcomes   # 同步 OUTCOME_LOG（需 CTO_OUTCOME_SECRET）
npm run cto:health
npm run gmail:scan     # 需 Cursor Secrets 的 GMAIL_*
```

---

_完整權限清單見 [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)._
