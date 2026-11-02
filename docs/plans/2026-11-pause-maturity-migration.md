# 暫停未納入備份保護的 maturity migration 入口

## 問題、根因與範圍

靜態盤點發現 `production-maturity-migrate.yml` 可由手動 dispatch 觸發：guard 核對 APPLY 後，preflight／apply／probe 使用 Production environment，apply 執行 `scripts/apply-maturity-rls-refund.mjs`，在 migration ledger 未確認時可執行 SQL。此 workflow 沒有 #503 的 migration 前加密備份鏈；實際是否有 Production environment reviewer、誰能派送、SQL 是否已在正式資料庫套用，均未查證。輸入 APPLY 及 environment 名稱本身不證明備份已保留或取得執行授權。此候選不連接資料庫，不執行 workflow 或 SQL。

採用先前停用其他 legacy migration 的模式：guard job 保留 GitHub-hosted runner 並限定一分鐘、`permissions: {}`，不 checkout、不使用 secrets 或輸入值，印出固定暫停訊息並以非零結束。preflight、apply、probe、summary 各明確設 `if: ${{ false }}`，保留原始步驟與依賴供日後審查；特別移除原 summary 的 `always()` 執行條件，避免跳過 migration 卻顯示已完成。手動 dispatch 因 guard 失敗而清楚呈現失敗，不能誤認成功。這不保護歷史 ref、其他 workflow 或直接呼叫腳本。

恢復任何入口前，需另行核對目標與資料庫身分、加密備份與可還原證據、所有寫入路徑、非 additive SQL 的適用授權、Production environment 與可回復的流程；本候選不啟用新路徑或改變 SQL。若需回復此程式變更，應透過重新審查的 PR，而非把舊 workflow 當成安全 migration 流程。

## 驗證

以真實 YAML 解析確認只有手動 dispatch、guard 零權限且固定失敗、四個後續 job 全固定停用與原依賴；以合成變異測試移除停用條件、加入敏感 env 或 checkout、改為成功及錯誤 summary 行為均被拒。這些是靜態驗證，不等於執行 GitHub workflow，亦不證明其他 migration 入口均受保護。

## 參考做法

- [GitHub Actions 使用條件控制 job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)：job 條件可明確阻止執行，與失敗的前置 guard 雙重防護。
- [GitHub Actions 權限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)：guard 使用空權限，不依賴需要寫入權限或 repository secrets。
- 參考 repo 的 `apply-migration-ops-events.yml` 明確暫停公告；根因是遺漏未備份的獨立寫入入口，單純加說明不能阻止手動 dispatch。
