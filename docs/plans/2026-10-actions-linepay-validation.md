# Actions 更新與 LINE Pay 環境工作流程

問題：#489 的 Actions 更新觸及 LINE Pay workflow，PR job 在呼叫 Vercel 操作腳本時失敗；GitHub job 日誌下載回 403，因此無法斷言確切失敗原因。既有 PR workflow 會使用正式環境 token，且曾針對特定分支自動執行環境變更。

盤點：檢查 `.github/workflows/ops-linepay-vercel-env.yml`、`scripts/ops-linepay-vercel-env.sh`、現有 Vitest、PR #489 與 GitHub job steps；沿用腳本的模式白名單、敏感值輸出檢查及手動執行入口。未找到仍存在的特殊分支。

方案：PR 僅執行無正式憑證的腳本行為測試，使用隔離目錄與假 Vercel CLI；正式 inspect 與兩種既有環境操作保留在 main 的 workflow_dispatch，仍要求 token，失敗即失敗，環境變更後仍由原 canonical workflow 部署。替代方案是在 PR 跳過失敗步驟：缺乏驗證且無法區分真正失敗，不採用。PR 的假資料測試不代表正式 Vercel 環境已通過檢查；需要時仍須手動執行 inspect。

驗收：PR 測試覆蓋缺 token、非法模式、inspect 不洩漏假憑證及不執行修改；假 CLI 不得聯網。workflow PR 不取得正式 secrets 或 actions 寫入權限；手動路徑保留原有操作及檢查，不測試正式環境或進行支付。執行既有 Actions SHA gate、lint 與定向測試。上線後由 CI 檢查最終提交；回滾可恢復原 workflow，但應注意它會讓 PR 接觸正式環境。

安全補強：原始 stdout、stderr 和操作報告只寫私有暫存，檢查成功後輸出限定欄位的摘要；偵測疑似 channel 值或任何錯誤都不發布 artifact。sandbox URL 已存在但不相同或無法讀取時，不修改環境並中止後續部署。測試只使用假的 CLI、假的憑證和隔離目錄。

未解決的上線阻礙：目前 Vercel CLI 尚未鎖版，已評估的兩個版本均有高／重大漏洞；CLI 表格也不提供可驗證的完整筆數或分頁資訊。解析器會拒絕未知格式，但無法證明格式正確的表格沒有截斷。這些問題解決並經獨立審查前，不應執行正式環境操作。不得假設任何現有 LINE Pay key 屬於 sandbox。

參考：[GitHub Actions 安全強化](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) 建議最低權限及限制 secrets；[actions/checkout](https://github.com/actions/checkout)（MIT）以完整 commit SHA 固定。原失敗是 credential-dependent 檢查與 PR 自動驗證耦合，具體 Vercel 錯誤尚無可讀日誌佐證。
