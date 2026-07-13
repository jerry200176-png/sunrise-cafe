# Code Review 指南

> 版本：v1.0
> 日期：2026-07-13
> 適用：sunrise-cafe 專案

---

## 一、審查重點

Reviewer 按以下優先順序檢視 PR：

### 1️⃣ 正確性
- 邏輯是否正確？邊界情況（empty、null、負數、極端值）是否處理？
- 時間相關邏輯是否正確轉換時區？（專案使用 `Asia/Taipei`，Vercel 跑 UTC）
- 資料庫查詢是否考量 RLS 政策？

### 2️⃣ 安全性
- 輸入驗證：API 參數是否 sanitize？
- 敏感資料：無 API key、token、密碼硬編碼或暴露在 client bundle
- LINE Bot：webhook 簽章驗證是否正確？
- Supabase RLS：anon 角色是否能存取不該存的表？（參照 `supabase/schema.sql`）

### 3️⃣ 錯誤處理
- API 錯誤是否回傳正確 HTTP status code（4xx / 5xx）？
- UI 是否有對應的 error state / loading state？
- 外部服務（Stripe、LINE、Supabase）呼叫是否有 try-catch 或 fallback？

### 4️⃣ 可維護性
- 命名是否清楚表達意圖？
- 是否有過度複雜的邏輯可拆分？
- 是否留下 TODO / FIXME / HACK？（必要時開 issue 追蹤）

### 5️⃣ 效能
- 有無 N+1 query？（特別是 Supabase 關聯查詢）
- 有無不必要的 re-render？（React 元件）
- 有無不必要的 API 重複呼叫？

---

## 二、審查流程

```mermaid
sequenceDiagram
    participant Author
    participant CI as GitHub Actions
    participant Reviewer

    Author->>GitHub: Push 分支 → 開 PR
    CI->>CI: 自動跑 lint + build + test
    CI-->>Author: ✅ 或 ❌
    Author->>Reviewer: 指派 Reviewer（至少 1 人）
    Reviewer->>PR: 24h 內開始審查
    alt 有問題
        Reviewer->>PR: Comment / Changes Requested
        Author->>PR: 修改程式碼 / 回應
        循環直到解決
    else 沒問題
        Reviewer->>PR: Approve
    end
    Author->>main: Squash Merge
    Author->>GitHub: 刪除遠端分支
```

### 時限

| 階段 | 目標時限 |
|------|---------|
| Reviewer 開始審查 | PR 建立後 **24 小時內** |
| Author 回應 comment | **48 小時內**（可標明「週末後處理」） |
| 從審查到合併 | **5 個工作天內** |

---

## 三、退回標準

有以下任一情況，Reviewer **應標記 Changes Requested**：

| 類別 | 具體情況 |
|------|---------|
| ❌ CI 失敗 | lint / type-check / test / build 未通過 |
| ❌ 缺少錯誤處理 | API 無 try-catch、無 error status code |
| ❌ 輸入驗證 | API endpoint 未驗證 request body params |
| ❌ 敏感資料外洩 | token、API key、密碼暴露在 client 或 commit |
| ❌ 邏輯錯誤 | 時區未轉換、計算公式錯誤、RLS 遺漏 |
| ❌ 文件遺漏 | 環境變數、migration、API 變更未更新對應文件 |

### 非退回理由

以下情況**不應**退回（可用 comment 建議，但不 blocking）：

- 程式碼風格偏好（除非違反 ESLint 規則）
- 線上加減空白或換行（可在 squash merge 時整理）
- 作者選擇了另一種合理的實作方式

---

## 四、通過標準

以下條件**全部滿足**才算通過：

- [ ] CI ✅（lint + build + test）
- [ ] 所有 comment 已解決或獲得合理回應
- [ ] 測試涵蓋新增程式碼的 happy path + error path
- [ ] 符合專案 coding style（ESLint + TypeScript strict）
- [ ] 無安全疑慮（參見審查重點 #2）
- [ ] 文件已同步更新（CHANGELOG / docs / CLAUDE.md 視需要）

---

## 五、審查文化

### ✅ 鼓勵的行為

> 問問題而不是下指令
> 「這裡為什麼選擇陣列而不是 Map？」取代「改成 Map」

> 指出好的設計
> 「這個 error boundary 放得很好，解決了 Cron crash 時 UI 白畫面的問題」

> 分享知識
> 「這個 Supabase RLS policy 可以在 docs/ 補一筆，下次大家就不會踩坑」

### ❌ 避免的行為

- 「LGTM」沒有實質回饋（至少確認變更範圍）
- 要求完美零瑕疵才合併（實務上可迭代改進）
- 個人風格的強加（縮排、命名偏好等）

### 新手友善

- 對初次貢獻者多給指引少給壓力
- 在 comment 中附上參考資料連結（文件、ADR、相關 PR）
- 用「建議」取代「你錯了」

---

## 六、與 Governance 的關係

本指南與 [`ENGINEERING_GOVERNANCE.md`](./internal/governance/ENGINEERING_GOVERNANCE.md) 互補：

| 面向 | 本指南 | ENGINEERING_GOVERNANCE |
|------|--------|----------------------|
| 目標對象 | 開發者（Author + Reviewer） | CTO Agent / 治理系統 |
| 範疇 | 單一 PR 的審查實務 | 全 repo 健康度與治理迭代 |
| 強制力 | Reviewer + CI | `npm run cto:governance` gate |

> 治理 gate 失敗時（`cto:governance` exit 2），應先修復健康度再開新 feature PR。

---

## 七、常見地雷（sunrise-cafe 專屬）

回頭 review 時特別注意這些專案已知的陷阱：

- [ ] **時區**：Vercel UTC vs 台灣時間，`new Date()` 不轉換是 bug
- [ ] **LINE 雙 Channel**：群組 Bot vs 客人 Bot 的 token 是否用對
- [ ] **Supabase RLS**：anon 能不能 INSERT/UPDATE/SELECT 不該碰的表
- [ ] **Stripe**：webhook signature 驗證、idempotency key
- [ ] **migration**：新增 migration 後要確認執行順序
- [ ] **環境變數**：新增的 env 是否已在 Vercel 設定？`docs/ENV.md` 是否更新？

---

*版本：v1.0 | 最後更新：2026-07-13*