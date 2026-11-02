# #489 Actions pin 全量研究候選

## 問題與邊界

#489 的舊分支基於過時主線，其中 LINE Pay 權限路徑已由 #554 停用，migration 路徑已由 #549／#503 和 #526 保護；不能直接套舊檔覆寫。現行 main 的 CI 已升級 checkout、setup-node、gitleaks，其他 workflow 仍使用舊 Action。根因是升級跨越執行環境、憑證、壓縮及復原契約；只換版本號與通過一般測試無法證明正式備份與回復可用。

此候選僅將剩餘原有 checkout v4、setup-node v4 和 upload-artifact v4 固定 SHA 更新為已核對官方 tag 的 v7；已升級項與 download-artifact 維持現狀。所有原上傳位置顯式使用 `archive: true`，維持 ZIP、名稱與多檔行為；唯一原本無快取的 setup-node job 顯式 `package-manager-cache: false`，避免未來 packageManager 欄位令 v7 自動啟用快取。保留原有 job 權限、事件、steps、artifact 名稱／路徑／retention、失敗條件、禁用 job 與 LINE Pay 暫停。

## 已知證據和限制

- #557 的 GitHub run [41400586277](https://github.com/jerry200176-png/sunrise-cafe/actions/runs/41400586277) 在合成 PR 以 v7 上傳、v4 同 run 按名稱跨 job 下載成功；包含名稱、ID／digest 格式、檔案及內容核對，未使用正式備份、資料庫或使用者 secrets。
- 該 canary 不取得 `actions: read` 權限，故未驗服務端實際期限、ID 與名稱對應或 ZIP digest；v4 下載器對 digest 不符只警告。不能依此聲稱正式 backup/recovery 完整性或成功復原，也不能把 retention 輸入當作實際保留期限。
- checkout v7 的 Node 24 需要 runner >= 2.327.1；checkout v6 起憑證改存在 `RUNNER_TEMP`，從 Docker container action 做驗證需要 runner >= 2.329.0。checkout v7 對 `pull_request_target`／`workflow_run` fork PR 的不安全 checkout 預設拒絕。repo jobs 目前使用 GitHub-hosted `ubuntu-latest`，但此靜態分析不確認實際 runner 版本或所有 workflow 路徑。
- setup-node v7 action 自身使用 Node 24 不改 workflow 配置的應用 Node 版本；它可依 packageManager 預設啟用 npm 快取。現行 package.json 未設該欄位；不使用 cache 的 job 已顯式關閉，既有 `cache: npm` 原樣保留。
- 既有實際 production、rollback、加密 backup、三日保留及 Supabase 完整還原尚未透過此候選驗證；正式資料來源身分與 #485 未因升級解決。本地測試不能代替 exact-head GitHub CI 與獨立複核。此候選尚不適合憑合成測試宣稱完整相容或關閉全部安全議題。

## 參考做法

- [actions/checkout v7.0.1](https://github.com/actions/checkout/tree/v7.0.1)（MIT）：Node 24 runner、憑證保存及 fork PR 限制；保留 `persist-credentials` 原設定。
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/tree/v7.1.0)（MIT）：區分 action runtime 與所安裝 Node 版本，敏感 workflow 明確管理快取。
- [actions/upload-artifact v7.0.2](https://github.com/actions/upload-artifact/tree/v7.0.2) 與 [download-artifact v4.3.0](https://github.com/actions/download-artifact/tree/v4.3.0)（MIT）：ZIP 預設、ID/digest 和同 run 下載；不同 run、repository 權限與真實 restore 需另驗。

## Checkout 憑證與現有 workflow 逐項盤點

checkout v4 預設持續保存憑證在本機 Git 設定，v7 預設仍為 `persist-credentials: true`，但把憑證設定寫在 `RUNNER_TEMP` 下獨立檔案，再由 Git 設定引用。正常的 post-job cleanup 會移除設定；不可推定強制中止、故障、runner 遺留或其他步驟存取暫存目錄時一定完成清理。任何有權執行同一 job 的步驟或非可信相依套件仍可能取得 job 的持久化認證；本候選不擴大或縮小既有權限，但也不把位置改變當作安全隔離。`persist-credentials: false` 的步驟則在 checkout 後移除驗證資訊。上述語義見 [v7 action 來源](https://github.com/actions/checkout/blob/v7.0.1/src/git-source-provider.ts) 和 [憑證處理](https://github.com/actions/checkout/blob/v7.0.1/src/git-auth-helper.ts)。

| 現有 workflow | 認證設定與實際互動 |
| --- | --- |
| `production-code-only.yml` | release、recovery 兩次 checkout 均 `persist-credentials: false`；使用明確 `GH_TOKEN` 執行版本／部署 API，兩份記錄單檔上傳，按相同名稱下載；不依賴 checkout 保存 Git token。 |
| `ops-linepay-vercel-env.yml` | validate checkout 為 `persist-credentials: false`，operate 為零權限失敗公告；保持 #554 暫停，不執行舊 Vercel 路徑。 |
| `ci.yml`、`dependency-review.yml` | 先前已採 v7；預設保存 checkout 認證，CI 的 GitHub API 使用明確 token，獨立 PR 不驗證其他 workflow 的寫入。 |
| `business-intelligence.yml` | 預設保存 checkout 認證並以 `git push` 嘗試提交快照；v7 官方表示普通 Git 呼叫持續支援，但此候選未對真實 repository 執行 push，成功與否仍受權限／規則保護限制。 |
| `autonomous-canary.yml`、`autonomous-loop.yml` | 明確傳入自動 GitHub token，使用預設持久化，呼叫的 loop 腳本包含 Git fetch/push；事件、權限及現有自我 dispatch 限制完全未變，未執行這些 workflow 或寫入。 |
| `governance.yml`、`orchestrator.yml`、`github-hygiene.yml` | 預設保存 checkout 認證，也有明確 `GH_TOKEN`；本次不改呼叫、權限或證據檔路徑。 |
| `activate-reservation-preorder.yml`、`send-line-reminder-backup.yml`、`verify-production.yml`、`incident-line-readonly.yml` | 預設保存 checkout 認證，分別為手動啟用／通知／正式驗證等用途；沒有以本候選執行或測試正式服務。 |
| `apply-migration-line-reminder-deliveries.yml`、`apply-migration-market-parity.yml`、`apply-migration-ops-events.yml`、`apply-migration-reminded-7d.yml`、`apply-migration-reservation-preorder.yml` | 留在已停用的 apply jobs 中，公告 job 不 checkout；保留 #549 暫停及 #526 的驗證邏輯。 |
| `production-deploy-migrate.yml` | 六個 checkout 在停用的 legacy DAG；仍需未來另行審查。其 PostgreSQL 容器用於 dump/restore，未看到在 Docker container action 內執行需 checkout 認證的 Git 命令；這不保證其餘所有隱式呼叫均相容。 |
| `production-maturity-migrate.yml` | #558 已使零權限 guard 固定失敗，preflight、apply、probe 與 summary 各自固定停用；舊步驟保留但不執行，該候選僅更新停用步驟的 pin。其他執行入口和歷史 ref 不受此暫停保護。 |
| `artifact-v7-canary.yml`、`agent-provenance.yml` | 未使用 checkout；其中前者只在 PR 操作合成檔案。 |

以上檢索了 workflow 明示的 Git／GH／Docker 命令及其 repository 腳本呼叫；沒有在其他權限或 live 資料上證明 token 清理、Git push、rollback 或 hosted runner 版本。官方要求容器 action 內認證 Git 必須 runner >= 2.329.0；未發現明示此模式，不等於證明完全不存在或所有 runner 符合。

## 合成測試和回復方案

離線解析所有變更前後的 workflow YAML，核對除了核定的三種 SHA 替換、明確 archive true 及唯一缺 cache 的 job 新增 package-manager-cache false 外完全一致；另對 production baseline／candidate 的 artifact 名稱、路徑、七日輸入、失敗策略及回復下載 pin，與四個停用的備份 job 的路徑、三日輸入、ID/digest 引用及 pause，作正向與變異負測。保留 #557 真實 canary 的限制，其 ID/digest 驗證僅限格式，下載後內容 hash 對合成材料有效，不構成伺服器 ZIP digest 或 expiry 證明。

若後續 exact-head CI、獨立審查與部署檢查表明 action 升級失敗，應透過新 PR 回復本次 19 個 workflow 的三種 Action SHA、明確 archive／cache 參數及此候選測試，遵守當時適用的 code-only manifest、CI、部署和驗證流程；保留 #549／#554 暫停與 #526 邏輯，禁止藉回復啟動 migration。檔案回復不等於找回消失的 artifact；若發生真實復原不明確，應依既有 D8／恢復程序處理，不能以合成 canary 假設可還原。


## 與合成 recovery canary 的整合

本 successor 在 #558 的 main 基準上整合獨立審查過的 19 個 workflow pin 候選與另一個 PR-only 合成 canary：PR CI 以 v7 預設 ZIP 上傳虛構 baseline／candidate JSON，再以 v4 跨 job 按名稱下載，使用實際 recovery 函式與禁止一般 Python socket／DNS 的 fake API 測身分一致、衝突與缺檔 fallback。verify job 僅 `contents: read`、checkout 不持久化 token、無 `actions: read` 或使用者 secrets；該 token 仍具有 repository contents 讀取權限，並非可信執行來源隔離。詳見 `2026-11-artifact-recovery-canary.md`。

此次合成測試不代表正式 Git push、實際 rollback、server expiry、ID 與名稱綁定或 ZIP digest 已驗證。即使測試通過也不解決 #485；server expiry 與 digest mismatch 的既有限制仍需另行處理。#537 已先合併其文件與未啟用草稿，本候選保留兩者；若其他變更先合入，須重設 exact main 基準、manifest、CI 與獨立 review。本研究尚不啟用任何正式 migration。
