# #437／#506：訂位與付款競態的隔離契約研究

**僅是合成 PostgreSQL 契約研究，不是應用功能、正式 migration、付款政策、部署或問題已解決。** #506 現有 reservation snapshot CAS 對 stale 狀態有保護，但訂金付款、provider 請求、預點單與通知沒有因此成為同一筆交易；LINE Pay 既有付款與 reservation 鎖順序也需另行確認及協調。自動逾期取消目前依既有 ADR 預設關閉，本研究不更動設定。

## 研究假設

- 假設所有參與路徑遵守相同的鎖序：先 lock reservation，再 lock 對應 payment attempt；在 provider 請求前提交 durable `creating` claim。已有 `creating`、`pending`、`confirming`、`unknown` 時取消應 defer，取消先提交時新 claim 被拒。未知結果不自動重新扣款。
- 若 provider 成功結果晚於取消，合成模型保留事件證據並記為 `reconciliation_required`，不靜默把已取消訂位標為已付、也不送付款成功 outbox。這是供審查的行為，不授權自動退款或認定現有付款政策。
- 假設 reservation 更新與資料庫 audit/outbox 在同一交易，失敗一起 rollback；外部通知由後續可靠程序投遞。這不等於證明外部訊息 exactly-once 或預點單已經納入交易。
- 恢復時段與新訂位需由資料庫 exclusion constraint 防止重疊；合成 fixture 使用自己的 schema，不代表正式 schema 與所有現有流程已驗證。

## 如何重跑

執行 `python3 scripts/research/reservation-payment-races/run.py`。需可信本機 Docker daemon、root 擁有的 `/var/run/docker.sock`、Python 3 與已存在的 `postgres:17-alpine` 映像；程式明確使用該 Unix socket、獨立空白 Docker config 與精簡程序環境，拒絕不可驗證的 socket，`--pull=never` 禁止下載映像。它建立獨立容器，檢查 `--network none`、PGDATA tmpfs、沒有 bind/volume/ports、server major 17，僅寫合成資料，結束自動移除容器。Socket 檔案權限檢查不能證明本機 daemon 未被替換或轉送，因此仍需可信工作站／daemon。隔離工具測試可執行 `PYTHONDONTWRITEBYTECODE=1 python3 scripts/research/reservation-payment-races/test_isolation.py`。不得改連正式資料庫，不需要任何正式憑證。

每項並行案例用兩條獨立 psql session：先讓第一筆交易保持未提交，再送第二筆操作；只在 `pg_stat_activity` 顯示第二條 session 等待鎖，且 `pg_blocking_pids` 確認實際被第一條交易阻塞後才提交第一筆，檢查兩筆結果與最終資料庫狀態。這是同步屏障，不靠 sleep 猜測兩筆交易有無重疊。

已驗證的合成模型：

1. 取消／到店兩個先後順序，敗方 stale，只有勝方一筆合成 audit/outbox，NULL 付款欄位不變。
2. Stripe／LINE Pay 名稱的合成 claim 對應 creating、pending、confirming、unknown：claim 先則取消 defer；取消先則 claim 拒絕，記憶體 fake provider 呼叫計數為零。重複 claim 不重呼叫；這是 harness 的 fake，不測真實 provider SDK 或網路。
3. 付款成功／取消兩個先後順序：已付阻止逾期取消；取消後的成功事件進待對帳且保留證據、不產生 paid outbox。同一合成 webhook 在兩條 session 並行時只有一筆事件與 outbox。
4. 合成 outbox 寫入後丟錯使狀態與 audit/outbox 同步 rollback；重試只產生一筆 outbox。外部發送、失敗重試時序與真實預點單不在此證據範圍。
5. 合成 exclusion constraint 在恢復／新訂位兩個先後順序都禁止時段重疊；不等於正式 API 已正確回應 409。

尚未驗證：真實 LINE Pay／Stripe 請求或 webhook、現有 `markDepositPaid`／`finalize_line_pay_payment`、真實 notification worker、付款退款或爭議政策、權限、真實 schema migration、實際 customer/admin UI，以及 #437 的完整驗收。所有參與路徑若未採用相同鎖序與 durable claim，此合成結果無法消除現有競態。實際方案需要獨立設計、F1/F4 適用判定、遷移與故障恢復審查、隔離整合測試及部署驗證。

## 參考做法

- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)（PostgreSQL License）：以 row lock 固定交易順序，使用真實 session 與等待觀察驗證，而非僅以 Promise mock 模擬。
- [PostgreSQL exclusion constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION)（PostgreSQL License）：讓資料庫在競態下阻擋重疊時段。
- 既有 `settle_reservation_checkout` 的 row lock 與 LINE Pay notification outbox 僅作專案內模式參考，不代表付款與 lifecycle 已整合。根因是跨路徑 read-then-write 與 provider 執行窗口，單一 reservation CAS 只能避免部分 stale write。
