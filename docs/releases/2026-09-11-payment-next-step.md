# 付款查詢下一步一致性 — 交付證據

狀態：本機整合驗收通過，待 required CI 與 production 驗證。Astra 為交付／整合 owner，唯一 Luna 為有界實作者；一次退修後剩餘缺口由 Astra 接手。

## 授權與所有權

- Founder 2026-09-11 明確 GO：既有查詢頁、付款 CTA 與 LINE 下一步一致性，包含測試、release notes、必要 metadata、green-gated merge、正常 production activation 與驗收。
- 只讀後端權威付款狀態；待審不催繳／重報，已收款才顯示確認。通知錯誤不能回寫付款狀態。
- 不改品牌、帳務／扣堂／權限／合約政策，不做歷史修復、真客通知測試或補發；無 schema、ledger、通知平台新建。
- agent-start task `payment-next-step-consistency-20260911`，branch `chore/task-payment-next-step-consistency-20260911`，session `b516c963596a4397aa9788580bcc9fbb`。
- #340/#341 已合併且沿用；[原 PR 所有權協調](https://github.com/jerry200176-png/sunrise-cafe/pull/341#issuecomment-5632733860)。未找到同源活躍產品 PR，不接管依賴/security工作。
- 無原 in-app 回報，本產品增量走既有 CHANGELOG／release index，不製造假回報；#257 是部署所有權修復，不把它誤作本產品案件。

## 基線與適用檢查

- main / production / deployment SHA `6a6508ed0d11888ab995a96774b9ee1efb9b21f8`，09:54 UTC production-identity GREEN、health ok。memory rate limit 仍 degraded_per_isolate，不屬本包修復。
- [既有 deploy](https://github.com/jerry200176-png/sunrise-cafe/actions/runs/34564399489) success；[verify](https://github.com/jerry200176-png/sunrise-cafe/actions/runs/34564948791) 的 SHA poll、health、migration drift 實際 steps success，不僅引用 worker 報告。
- R1/T1 UI 修復；不改付款資格／狀態遷移／通知呼叫。若發現必須改該邊界，停止該擴張。
- required checks：Lint & Build、Playwright smoke、Agent Session Provenance；保留完整測試、typecheck baseline、migration artifact contract、gitleaks。
- launcher preflight passed；首次 in-tree preflight 回 `dirty worktree`，差異只有 launcher 所產 manifest。驗證並提交該 metadata 後原命令 passed，未改或跳過檢查。
- Exo doctor 原始結果：`Scaffold: 1 missing path(s): .exo/logs`；config、governance drift、scan freshness、ticket validity、tracked governance 均通過。current portfolio bootstrap 將 Exo 定義為 experiment-only、agent-control 為 canonical；不新增 Exo framework 或把 derived adapter 當新 gate。本包不修改 gate／policy。

## 驗收與 rollback

- 基線全套 `npm test`：98 files passed、1 skipped；514 tests passed、1 skipped（migration drift CI-only fixture）；23.05s，local-heavy-gate序列執行。未改assertion或略過額外測試。
- Astra整合red：Next暖機後，390px pending_review仍有1個LINE Pay付款按鈕；`e2e/payment-next-step.spec.ts:50`要求0而實際1。證明只改卡片、未改sticky候選仍不符合GO，已退修。首次cold compile超時另外記錄，不作產品失敗證據。
- 退修後 rejected 卡片仍有付款按鈕（expected 0 / actual 1）；Astra 接手明列允許顯示付款卡的狀態，並移除未證實的一小時審核承諾。未知 review enum fail-safe 顯示未知，不推定可付款。
- 本機整合 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test e2e/payment-next-step.spec.ts e2e/payment-query.spec.ts --workers=1 --max-failures=2`：12/12 passed，35.6s。390px/1440px 均操作實際 Next 查詢頁；透過產品「返回」連結回首頁，再 browser back 重新查詢。不是獨立 HTML。測試使用 API fixtures，不代表真實扣款／收訊。
- 修改後全套 unit：99 files passed / 1 skipped，519 tests passed / 1 skipped，21.35s。既有 LINE cards / payment-events / notification retry 測試直接沿用；無 LINE 發送實作變更。
- lint passed（兩個既有 unrelated unused-variable warnings）；typecheck baseline passed（current 7、new 0）；migration artifacts 16/16、production workflow contract passed。
- 必要畫面由整合測試產生於 ignored `test-results/payment-next-step-付款下一步-{390,1440}px-後端待審→已收款；失敗重試與跨頁返回不重付-chromium/{pending,paid-notification-failed}.png`。Astra 親自檢視手機長中文狀態卡；畫面保留本機，CI run 另記測試結果，不宣稱目前 workflow 已上傳畫面 artifact。不提交測試個資或環境檔。

- 整合 Next 查詢頁：手機／桌機、長中文、pending/paid/rejected/unpaid/unknown、載入／空／錯誤、跨頁返回、重複查詢及狀態刷新。
- 所有測試付款資料隔離，所有 mutating/payment/LINE API 禁止流向真實服務。production 頁面的攔截 fixture 只能證明部署 UI 狀態呈現，不冒充真實付款端到端。
- 先保存測試 revision、必要畫面與部署 identity；未取得真實測試身份或資料時明列，不讀真客資料填補。
- Rollback 基線：`6a6508ed0d11888ab995a96774b9ee1efb9b21f8`／deployment `6386821373`。由既有 production owner path revert 本包或回前版；保留所有 payment_events 與通知 ledger，不重播付款或訊息。
- 真人理解率、實際 LINE 收訊／已讀均未驗證。
