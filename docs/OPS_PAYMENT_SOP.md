# Payment SOP — 訂金收取標準作業程序

**CTO OS v2 · Company-first · 對應 Issue #53**  
**Artifact ID:** ART-003 · Registry: [`OPS_ARTIFACT_REGISTRY.md`](./OPS_ARTIFACT_REGISTRY.md)  
**Owner:** 店長 / 櫃台  
**Review cadence:** 每日營業結束；每週一 Outcome Review 對照訂金率  
**Success metric:** `pending_review` 當日清零；4 週 rolling 訂金率 ≥80%  
**Retirement:** 訂金率 ≥85% 連續 8 週且審核自動化上線 → 降為 onboarding 附錄  
**後台:** https://sunrise-cafe-six.vercel.app/admin/payments

> **目標：** 在無付費閘道下，最大化訂金收取率（≥85%）與審核正確性。  
> 本 SOP 優先於新功能開發——多數流失來自**流程**，不是缺程式。

---

## 1. 客人旅程（客人視角）

```
訂位成功 → 收到 LINE 繳費通知（確認後+有金額）
    → 匯款 / LINE Pay / 截圖回傳
    → 店內審核通過
    → 訂位確認完成
```

**客人常見痛點 → 對應動作**

| 痛點 | 店內動作 |
|------|----------|
| 不知道匯哪個帳號 | 後台「分店管理」確認 `payment_info` 已填 |
| 已匯款但沒確認 | 每日 2 次檢查 `/admin/payments` |
| 截圖模糊 | 拒絕並請重傳（SOP §4） |
| 快逾期 | 主動 LINE 提醒（話術 §5） |

---

## 2. 店員每日節奏

| 時段 | 動作 | 時間 |
|------|------|------|
| 開店 | 打開 `/admin/payments` → 清空待審核 | 10 min |
| 午間 | 再看一次待審核 + 風險清單 | 5 min |
| 關店前 | 對明日訂位檢查未付訂金 | 5 min |

**SLA：** 截圖提交後 **4 小時內** 完成審核（對應 Executive KPI）

---

## 3. 審核標準（`/admin/payments`）

### 通過（Approve）條件

- [ ] 金額與訂單 `total_price` 訂金比例一致（依店政策，通常全額或 30%）
- [ ] 匯款人／末五碼可對應訂位（電話或備註）
- [ ] 截圖為銀行／LINE Pay **成功畫面**，非聊天紀錄

### 拒絕（Reject）條件

- 金額不符、無法辨識、重複提交、非本人訂單

**拒絕話術（LINE）：**

> 您好，這裡是{店名}。您傳送的付款資訊我們無法確認，麻煩重新提供匯款成功截圖（需含金額與末五碼），或來電 {店電話}，謝謝！

### 通過後

- 系統自動標記 `is_deposit_paid`
- 群組 Bot 會通知「客人已付訂金」（無需再手動）

---

## 4. 主動收款（提升轉換）

### 4a. 新訂位未綁 LINE

後台訂位列表 → 確認客人是否在訂位成功頁綁定 LINE  
未綁定 → 電話請客人綁定，否則無法推繳費通知

### 4b. 已確認但無金額

PATCH 訂位填入 `total_price` → 系統自動發 LINE 繳費通知（**同筆訂位只會自動送一次**；欄位 `payment_request_sent_at`）

### 4c. 手動催繳／重送

後台 → 訂位 → 「重送 LINE 繳費」（需已綁 LINE + 有金額）  
僅在客人說沒收到、或金額變更需重送時再按。確認訂位後**不必**再按一次。
---

## 5. 逾期前提醒話術（營收挽回）

對 `/admin/payments` 風險清單中 `would_auto_release = true` 的客人：

> 您好，這裡是{店名}。提醒您 {日期} {時段} 的包廂（訂位代號 {code}）訂金尚未收到，若 {期限} 前未完成付款，座位將自動釋放。若已匯款請回傳截圖，謝謝！

**財務影響：** 每挽回 1 筆 ≈ 保留該時段包廂營收

---

## 6. 常見錯誤（禁止）

| ❌ 禁止 | 原因 |
|--------|------|
| 口頭說「有付」就手動勾已付 | 無稽核、易糾紛 |
| 用 owner 密碼給所有店員 | 改用 `/admin/users` 建 staff 帳號 |
| 忽略待審核超過 1 天 | 客人以為沒收到、重複匯款或取消 |

---

## 7. 何時才需要工程？

|SOP 無法解決| 開 Issue / 排工程 |
|-------------|------------------|
| 話術已優化但訂金率仍 < 70% | #53 付款流程優化 |
| 需要銀行 CSV 批次對帳 | #62 |
| 需要自動報表 | 考慮 insights 頁（P2） |

---

## 8. 相關文件

- [`OPS_WEEKLY_BUSINESS_REVIEW.md`](./OPS_WEEKLY_BUSINESS_REVIEW.md) — 每週 KPI
- [`OPS_MIGRATION_RUNBOOK.md`](./OPS_MIGRATION_RUNBOOK.md) — 啟用 RBAC / payment_events
- [`PAYMENT_STATE_MODEL.md`](./PAYMENT_STATE_MODEL.md) — 技術狀態機
- `CLAUDE.md` — LINE 雙 Bot 設定

---

*Company-first MDU Round 8 · 直接服務 Issue #53 營收目標*
