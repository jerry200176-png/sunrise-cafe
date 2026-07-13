# Founder Action List

**Updated:** 2026-07-13 15:05 CST (employee dispatch — deploy verify)  
**Gate:** PASS · Overall **~85** / 100  
**SSOT:** [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)

---

## 目前阻塞（自動偵測）

| 項目 | 現況 | 解法 |
|------|------|------|
| Production SHA | 🟡 `main` `a52f8d4` ≠ prod `f4830c9` | Vercel Hobby 每日 deploy 額度（GHA 已觸發仍 `deploy_rate_limited`）；quota 重置後重跑 workflow 或手動 `vercel deploy --prod` |
| OUTCOME_LOG | ✅ **已量測** 2026-07-12（訂金率 82.4%） | 每週 `npm run cto:outcomes` |
| DB migrations | ✅ 核心已套用 | 選用：`line_group_id` |
| Gmail 自動掃信 | 🟡 Secrets 未設（可選） | 見下方 **Gmail 兩步設定** |
| Open PRs / Issues | ✅ **0 PR** · **1 issue** (#99) | — |

## GitHub 狀態（本輪）

| 指標 | 值 |
|------|---:|
| Open PRs | **0** |
| Open issues | **1** (#99) |
| `main` SHA | `a52f8d4` |
| cursor/* branches | 清理 merged remote（見 `GITHUB_TRIAGE.md`） |
| Bot can merge PRs | yes（agent PR tool） |

---

## Gmail 兩步設定（讓 Agent 幫你掃信）

Cursor 的 Secrets **不在** GitHub、也不在 Vercel，要在 **cursor.com 網頁** 設。

### 去哪裡找（兩個入口，擇一）

**入口 A — 整個帳號的 Secrets（最常見）**

1. 瀏覽器打開：https://cursor.com/dashboard/cloud-agents  
2. 看頁面**上方或左側**有沒有 **「Secrets」** 分頁（有時在 Settings 裡）  
3. 點 **Add secret** → 類型選 **Runtime Secret**  
4. 新增兩筆：
   - `GMAIL_USER` = 你的 Gmail
   - `GMAIL_APP_PASSWORD` = Google 應用程式密碼（16 碼）

**入口 B — 只給 sunrise-cafe 這個環境**

1. 打開：https://cursor.com/dashboard/cloud-agents/environments/r/github.com/jerry200176-png/sunrise-cafe  
2. 在環境詳情頁找 **Runtime secrets** / **Build secrets**（常在**右側欄**，要往下捲）  
3. 同上新增 `GMAIL_USER`、`GMAIL_APP_PASSWORD`

### 找不到 Secrets？

- 確認登入的是**擁有這個 repo 的 Cursor 帳號**  
- 用**電腦瀏覽器**開，手機版有時藏選單  
- 設好後要**開一個新的 Cloud Agent 對話**才會載入

### Google 應用程式密碼

1. [兩步驟驗證](https://myaccount.google.com/security) 要先開  
2. [應用程式密碼](https://myaccount.google.com/apppasswords) → 郵件 → 產生 16 碼

設好後回對話說「掃 Gmail」。

詳見 [`ENV.md`](../../ENV.md) § Gmail。

---

## 一鍵指令

```bash
npm run cto:outcomes   # 同步 OUTCOME_LOG（需 CTO_OUTCOME_SECRET）
npm run cto:health
npm run gmail:scan     # 需 Cursor Secrets 的 GMAIL_*
```

---

_完整權限清單見 [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)._
