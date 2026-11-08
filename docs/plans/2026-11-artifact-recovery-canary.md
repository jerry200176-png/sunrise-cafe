# 合成 artifact 與 recovery 邏輯的跨 job 契約

## 問題與目標

#557 已在真正 GitHub Actions 上用 v7 預設 ZIP 上傳及 v4 同 run 跨 job 按名稱下載合成材料，但 identity JSON 不是 production code 的真實輸入格式，不能證明原生 `read_record`／`recovery_candidate`／`recover` 能在下載後處理來源一致、衝突或缺檔。根因是檔案傳遞與回復決策分開驗證；此候選以固定虛構 SHA、deployment id 和純本機 fake API 把兩者連起來。

PR-only workflow 不使用使用者 secrets、Vercel、資料庫、真實備份或 `actions: read`，upload/download 使用 GitHub 同次 run 內部 artifact 機制。驗證 job 以 `contents: read` checkout 測試程式，關閉 checkout 持久化 token；只有合成資料、唯讀 repository 程式和 GitHub-hosted runner。驗證程式會禁止 Python 標準 socket 連線／DNS 路徑，這並非作業系統層級的網路隔離。此權限仍是 repository contents 讀取，非 artifact metadata 讀取；惡意 PR 可更改其程式，不能將本測試視為對同 PR 惡意修改的獨立邊界。

使用與正式相同形狀的 baseline 與 candidate JSON，v7 ZIP 依正式名稱樣式上傳，v4 依相同名稱下載；真實 recovery 函式僅注入會記錄呼叫且不連網的 fake API。核對雙來源相符時只對 synthetic baseline 呼叫 fake rollback；artifact／job output 相異、fake live alias 指向第三方 deployment、來源 commit 不同、baseline 檔缺失或 candidate 無任何可用身分且 fake live 指向 candidate 時拒絕 rollback。現有設計允許 candidate 檔缺失時以可信的同次 job output fallback，必須保留並測試，不能錯誤宣稱所有缺 candidate 檔都要失敗。

## 邊界

不測 Git push、服務端 artifact expiry、ID 是否對應名稱、上傳 ZIP digest 是否等於伺服器儲存內容，亦不修復 download-artifact v4 對 digest mismatch 只警告的現況。七天保留只是輸入，不保證服務端實際 expiry。fake API 成功不等於正式 Vercel rollback、加密備份、Supabase 還原或正式來源身分驗證；現有 #485 與 #489 的其他缺口仍在。此候選不觸發正式部署或修改 production workflow；舊 workflow 與 API 入口保持不動。

## 參考做法

- [actions/upload-artifact v7.0.2](https://github.com/actions/upload-artifact/tree/v7.0.2)（MIT）：使用預設 ZIP 與不可變 artifact；以無 secrets 合成材料進行同 run 測試。
- [actions/download-artifact v4.3.0](https://github.com/actions/download-artifact/tree/v4.3.0)（MIT）：依名稱下載同 run artifacts；server metadata、跨 run 權限與雜湊驗證另議。
- 沿用 `scripts/test_code_only_release.py` 的 fake API 注入；根因是 artifact 傳遞與真實恢復邏輯未接在一起驗證，並非真實 rollback 已驗證。

## Cancellation evidence extension (local candidate)

The prior phase probes end immediately. They prove ordinary failure output propagation,
but offer no observable point for an external cancellation. Repeating them cannot prove
that a cancelled producer still reaches the real classifier and conservative recovery.
Searched `phase`, `pre_create`, `recovery_candidate` and `recover` in the workflows,
existing canary, tests and #577 plan; reuse those helpers and the production shell text.

Add one synthetic producer with a named, finite 180-second pre-create barrier and native
job result, plus an `always()` observer in this existing workflow. The observer extracts
the production classifier's exact shell, feeds the real producer result/outcomes, and
records the classifier digest. Normal completion must pass. Cancellation must retain
`pre_create=false`; with no candidate identity, existing offline fake recovery must refuse
unknown ownership without rollback. Its synthetic baseline is observer-local, so this
does not test retention of the producer's baseline or production artifact downloads.
Reject another workflow or copied classifier: either would separate evidence from the
contract being tested. Focused tests cover wiring, both result branches, absent outputs
and refusal to accept an attempted create as pre-create cancellation. Rollback: revert
this canary-only extension; no production workflow, manifest, permission or gate changes.

參考做法: GitHub's [cancellation sequence](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)
re-evaluates `always()` and signals processes; [actions/runner (MIT)](https://github.com/actions/runner)
distinguishes outcome from conclusion. Reuse the patterns and existing code, without
copying runner internals. After review, an authorized no-secret PR run must first finish
normally; rerun only the producer and dependent observer, observe the named running
barrier through native GitHub job metadata, then cancel that exact run. Preserve native
cancelled status and collect run/attempt/head/job/step evidence. Hosted observer survival,
runner loss, provider rollback, concurrent writers and database restore remain unverified.
