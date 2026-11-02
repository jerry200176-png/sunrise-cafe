# LINE Pay 環境工作流程暫停與驗證

- 目的：在既有環境操作的受控替代方案完成前，暫停診斷及設定修改；客人現有付款流程與正式環境設定不受變更。
- 盤點：檢查現有 LINE Pay workflow、操作腳本、測試與 #489，沿用現有 PR 測試入口，不新增環境操作路徑。
- 方案：PR 只執行合成測試，使用唯讀權限；main 的手動 workflow 及舊腳本明確回報暫停並結束。保留輸入名稱與 git 歷史供日後設計。
- 驗證：解析 workflow 檢查 job、runner、權限及步驟；使用合成輸入確認舊腳本不執行外部操作。必要時重跑 CI 與獨立審查。
- 後續：恢復診斷或設定修改前，須審查固定版本工具、權限、輸出、完整性、受控啟用和回退。此變更不驗證其他 ref 或外部工具；同一 PR 可修改 workflow 與 contract，故 contract 不是獨立的惡意提交防護。

## 參考做法

- GitHub Actions 的 [GITHUB_TOKEN 權限](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)可按 job 限縮。
- [actions/checkout](https://github.com/actions/checkout)（MIT）支援 `persist-credentials: false`。
- 舊流程混合 PR 驗證與環境操作；分開驗證並暫停環境操作，待安全恢復路徑完成後再重啟。
