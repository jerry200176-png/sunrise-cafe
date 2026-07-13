# Founder Action List

**Updated:** 2026-07-13 15:25 CST (Round 27 — boss execution: #181 merged, Flex live on prod)  
**Gate:** PASS · Overall **~88** / 100  
**SSOT:** [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)

---

## 今日 P0（Founder／店長 — 工程無法代做）

| # | 動作 | 時間 | 文件 |
|---|------|------|------|
| 1 | **手機跑 LINE Flex 驗收**（#178 已在 prod `2248d24`） | 15 min | [`OPS_LINE_CARD_VALIDATION.md`](../../OPS_LINE_CARD_VALIDATION.md) |
| 2 | **店長會** — 未付訂金當日追蹤 | 5 min | [`OPS_PAYMENT_SOP.md`](../../OPS_PAYMENT_SOP.md) |
| 3 | 清 `/admin/payments` 待審（維持 0） | 2 min | — |

工程已完成：#180 驗收 SOP、#181 漏斗儀表板（等 deploy 上線後可在 `/admin/executive` 看轉換率）。

---

## 目前阻塞（自動偵測）

| 項目 | 現況 | 解法 |
|------|------|------|
| Production SHA | 🟡 `main` `dc00592` ≠ prod `2248d24`（差 3 commits，**客戶功能已含 #178 Flex**） | Vercel quota 重置後 deploy；或 `vercel deploy --prod` |
| 訂金率 | 🟡 **82.4%** < 85% | **店務 SOP** 優先；deploy 後看漏斗 UI 再決定是否改 UX |
| OUTCOME_LOG 自動同步 | 🟡 Agent 本地無 `CTO_OUTCOME_SECRET` | Vercel + GitHub Secrets 設同一組 → `npm run cto:outcomes` |
| DB migrations | ✅ 核心已套用 | 選用：`line_group_id` |
| Gmail 自動掃信 | 🟡 Secrets 未設（可選） | 見下方 **Gmail 兩步設定** |
| Open PRs / Issues | ✅ **0 PR** · **1 issue** (#99 deferred) | — |

## GitHub 狀態（本輪）

| 指標 | 值 |
|------|---:|
| Open PRs | **0** |
| Open issues | **1** (#99 — defer) |
| `main` SHA | `dc00592` (#181 funnel UI) |
| Production SHA | `2248d24` (#178 Flex **已上線**) |
| Merged this session | #180, #181 |

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

## CTO_OUTCOME_SECRET（KPI 自動同步 — 建議 5 分鐘）

讓 `npm run cto:outcomes` 與 Agent 能自動寫入 `OUTCOME_LOG.md`。

1. 產生隨機 32+ 字元字串  
2. **Vercel** → Project → Settings → Environment Variables → `CTO_OUTCOME_SECRET`（Production）  
3. **GitHub** → repo → Settings → Secrets → Actions → 同名 secret  
4. Redeploy 後本地或 CI：`npm run cto:outcomes`

詳見 [`ENV.md`](../../ENV.md) · [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md) § 最快路徑。

---

## 一鍵指令

```bash
npm run cto:outcomes   # 同步 OUTCOME_LOG（需 CTO_OUTCOME_SECRET）
npm run cto:health
npm run gmail:scan     # 需 Cursor Secrets 的 GMAIL_*
```

---

_完整權限清單見 [`FOUNDER_PERMISSIONS.md`](./FOUNDER_PERMISSIONS.md)._
