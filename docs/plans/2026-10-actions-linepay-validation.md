# Actions 更新與 LINE Pay 環境工作流程

問題：#489 的 Actions 更新觸及 LINE Pay workflow，PR job 在呼叫 Vercel 操作腳本時失敗；GitHub job 日誌下載回 403，因此無法斷言確切失敗原因。既有 PR workflow 會使用正式環境 token，且曾針對特定分支自動執行環境變更。

盤點：檢查 `.github/workflows/ops-linepay-vercel-env.yml`、`scripts/ops-linepay-vercel-env.sh`、現有 Vitest、PR #489 與 GitHub job steps；沿用腳本的模式白名單、敏感值輸出檢查及手動執行入口。未找到仍存在的特殊分支。

方案：PR 僅執行無正式憑證的腳本行為測試，使用隔離目錄與假 Vercel CLI；正式 inspect 與兩種既有環境操作保留在 main 的 workflow_dispatch，仍要求 token，失敗即失敗，環境變更後仍由原 canonical workflow 部署。替代方案是在 PR 跳過失敗步驟：缺乏驗證且無法區分真正失敗，不採用。PR 的假資料測試不代表正式 Vercel 環境已通過檢查；需要時仍須手動執行 inspect。

驗收：PR 測試覆蓋缺 token、非法模式、inspect 不洩漏假憑證及不執行修改；假 CLI 不得聯網。workflow PR 不取得正式 secrets 或 actions 寫入權限；手動路徑保留原有操作及檢查，不測試正式環境或進行支付。執行既有 Actions SHA gate、lint 與定向測試。上線後由 CI 檢查最終提交；回滾可恢復原 workflow，但應注意它會讓 PR 接觸正式環境。

參考：[GitHub Actions 安全強化](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) 建議最低權限及限制 secrets；[actions/checkout](https://github.com/actions/checkout)（MIT）以完整 commit SHA 固定。原失敗是 credential-dependent 檢查與 PR 自動驗證耦合，具體 Vercel 錯誤尚無可讀日誌佐證。
