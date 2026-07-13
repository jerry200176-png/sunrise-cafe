# LINE Flex 卡片 — 店內 15 分鐘驗收腳本

**用途：** 每次 production 部署後（或換 Bot / 改話術後），用真實手機快速確認客人與群組通知皆為統一 Flex 版型。  
**前置：** 後台已登入、客人 Bot 可加好友、群組 Bot 在店內群組內。  
**程式對照：** `src/lib/line-cards.ts` · `src/lib/line-flex.ts`

> **2026-07-13：** Production 已在 `2248d24`（#178 Flex）。**可立即跑店內驗收** — 見 [`OPS_LINE_CARD_VALIDATION.md`](./OPS_LINE_CARD_VALIDATION.md)。  
> 若 `/api/version` 落後 `main`，僅影響後台漏斗 UI（#181）與文件；**不影響**已上線的 Flex 卡片。

---

## 準備（2 分鐘）

| # | 動作 | 通過 |
|---|------|------|
| P1 | 手機開啟 https://sunrise-cafe-six.vercel.app/book | ☐ |
| P2 | 後台開啟 `/admin/payments` 與 `/admin/reservations` | ☐ |
| P3 | `GET /api/admin/diagnose-line` 兩個 token 皆 ok（或後台診斷頁） | ☐ |
| P4 | 記下測試訂位代號：__________ | ☐ |

建議用**測試姓名 + 自己的手機**，訂位日選 **3 天後**，方便稍後取消。

---

## 客人 Bot（8 分鐘）

| # | 觸發方式 | 預期卡片 | 檢查點 | 通過 |
|---|----------|----------|--------|------|
| G1 | 訂位成功後依頁面引導加好友並傳訂位代號 | 綁定成功 `buildGuestBindSuccessFlex` | 焦糖色 header、訂位代號列、有 CTA | ☐ |
| G2 | 綁定後系統推播（或重新觸發訂金流程） | 訂金請求 `buildPaymentFlex` | 金額、匯款/LINE Pay 資訊、按鈕可點 | ☐ |
| G3 | 傳一張任意截圖（模擬匯款） | 待審核 `buildGuestPaymentPendingFlex` | 文案說明已收到、非自動標已付 | ☐ |
| G4 | 後台 `/admin/payments` 按核准 | 已核准 `buildGuestPaymentApprovedFlex` | 客人收到 Flex、群組收到待審→已付通知 | ☐ |

**選測（有時間再做）：**

| # | 觸發 | 預期 | 通過 |
|---|------|------|------|
| G5 | 錯誤代號綁定 | 錯誤卡 `buildGuestBindErrorFlex` | ☐ |
| G6 | 候補通知（需候補名額釋出） | `buildWaitlistFlex` | ☐ |

---

## 群組 Bot（3 分鐘）

在店內 LINE 群組目視（測試訂位會觸發部分通知）：

| # | 情境 | 預期卡片 | 檢查點 | 通過 |
|---|------|----------|--------|------|
| S1 | 新訂位建立 | `buildNewBookingFlex` | 姓名、日期時段、包廂、非純文字牆 | ☐ |
| S2 | 客人傳截圖（G3） | `buildPaymentPendingReviewGroupFlex` | 群組看到待審 Flex | ☐ |
| S3 | 後台核准（G4） | `buildPaymentConfirmedFlex` | 群組看到已付 Flex | ☐ |

**不需驗（排程／邊角）：** 明日提醒 digest、逾期釋放、改期、無訂位貓咪彩蛋 — 見 `docs/LINE.md` 排程說明。

---

## 收尾（2 分鐘）

| # | 動作 | 通過 |
|---|------|------|
| F1 | 後台取消測試訂位（避免佔用包廂） | ☐ |
| F2 | 截圖存檔：客人 G2/G4 + 群組 S1/S3 各一張 | ☐ |
| F3 | 若有失敗，記錄：訊息是純文字還是 Flex、production SHA | ☐ |

---

## 判定

- **PASS：** G1–G4 + S1–S3 皆為 Flex，CTA 可開啟官網／查詢頁。
- **FAIL（常見）：** `LINE_CUSTOMER_ACCESS_TOKEN` 未更新；或 prod SHA 低於 `2248d24`（無 Flex）。
- **記錄：** 結果可貼在週會或 `OUTCOME_LOG` 備註，不取代 `npm run test:e2e`（mock 流程）。

---

## 相關

- [`docs/LINE.md`](./LINE.md) — 雙 Channel、Webhook、Flex 對照表
- [`docs/OPS_PAYMENT_SOP.md`](./OPS_PAYMENT_SOP.md) — 訂金收取店務 SOP
- 自動化：`npm run test:e2e`（23 pass）· `npm run design:audit`
