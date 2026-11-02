# 暫停未經備份保護的舊 migration 入口

- 問題：#485 要求正式 migration 有可留存的加密備份，但五條獨立 workflow 與三個 migration POST 可直接執行 SQL，不經 #503 提議的備份檢查。ops-events 與 market-parity 原本可由 main push 自動啟動。#548 的 push 曾觸發 ops-events；該次 run 41376804738 確認只探測到既有表並返回，沒有執行 DDL。
- 盤點：搜尋 `.github/workflows/*migration*`、`src/app/api/admin/migrations`、`scripts/run-production-migration-phase.mjs`、`scripts/pre-migration-backup.sh` 與 #503；既有 `production-deploy-migrate.yml` 已停用，#503 的四階段保護並不涵蓋獨立入口。沿用現有 runner，避免另建 migration 執行器。系統頁原建議 POST ops-events，改成提示受控修復。
- 方案：移除兩條 workflow 的 push 事件，並以 job 層條件暫停五條手動執行；保留手動事件及完整 runner，以便另經審查建立受控恢復路徑。手動觸發時公告 job 不取得權限或 secrets、不連 DB，顯示暫停原因並以失敗結束，避免誤認 migration 成功。三個 API 保留既有 GET 檢查及 POST 認證；已授權 POST 回固定 503，不呼叫 probe 或 DB。替代方案是直接把 #503 備份流程複製到各入口，但同目標身分、實際上傳與 restore 證據尚未完成，不能據此啟用 production migration。
- 驗收：解析五個 workflow YAML，確認只保留 workflow_dispatch、apply job 的條件為 false、公告無 secret/DB 且以失敗結束，並保留原 runner；模擬測試涵蓋 API 原有權限、GET 查詢及 POST 不執行查詢/寫入。CI 應依最終 commit 執行。測試不觸發 workflow、不連正式資料庫。此變更不執行 migration、備份、還原或修改正式資料。
- 剩餘範圍：#503 與備份還原證據仍需獨立審核，#485 不能因此結案。此 commit 只約束載入新版 workflow 的 ref；可手動選取仍含舊定義的歷史 ref，須另由 GitHub 權限與受控發布程序限制，不能宣稱已全域禁用。外部腳本是否呼叫舊 POST 不能只憑本 repo 排除，這些呼叫現在會收到 503。還原這次暫停會重新開放缺備份保護的入口；不得當作例行回退。日後只在備份與目標核對、審查和驗證完成後，以受控變更重新開啟。

## 參考做法

- GitHub Actions 的 [job 層條件](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)可在執行 runner 前跳過整個工作，保留定義供後續審查。
- [actions/upload-artifact](https://github.com/actions/upload-artifact/tree/v4.6.2)（MIT）提供缺檔失敗選項與 artifact digest；此處不複製程式碼，也不將上傳成功誤認為解密還原驗證。
- 根因是多個獨立入口繞過共用備份 gate；本次暫停已盤點的舊入口，不能宣稱歷史 ref、外部工具或備份鏈已修復。
