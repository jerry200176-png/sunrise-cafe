# ops_events 自動寫入入口改為只讀確認

## 根因與範圍

REST 401、缺憑證、網路故障、快取過期與真正缺表不是同一件事。現有 `apply-migration-ops-events.mjs` 在缺 REST 設定但有資料庫 URL 時直接執行 SQL，且以錯誤文字判斷缺表；HTTP endpoint 對任何 probe 錯誤都可能執行 SQL；bootstrap 將未知結果視同缺表並自動寫入。本候選移除這三條 ops_events 的自動 SQL 執行，保留同一路徑供經授權的唯讀確認。獨立 workflow 不再取資料庫密鑰或嘗試寫入 fallback；後台提示改為請管理者核對，不再指示直接 POST 套用。

REST HTTP 200 且 `id` 查詢格式有效僅證明選取欄位的 REST 可見性，不證明完整 schema、ledger、RLS 或索引；所有缺表、缺欄、401、403、逾時、壞回應與缺設定都回失敗。即使真正缺表亦不自動執行，須另依現有治理流程準備實際目標、必要變更、備份、審核及驗證；不得為過檢查偽造 ledger。新環境不再由這三條路徑自動建立 ops_events。

## 參考做法

- [PostgREST tables/views](https://docs.postgrest.org/en/stable/references/api/tables_views.html)：固定 GET 表欄位查詢，不把驗證或 schema cache 故障視作安全執行 DDL 的證據。
- [Flyway versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations)：保留已套用版本的歷史，不修改既有 SQL；實際遷移與驗證各有明確契約。
- 沿用專案既有 Node fetch 與授權，不新增依賴。根因是驗證失敗被轉成寫入授權；症狀包括重播 additive SQL 與把失敗 workflow 當成功。

## 邊界與發布限制

僅移除 ops_events 的自動套用；bootstrap 的 market parity、LINE reminder 和 guest notification 等其他寫入入口仍未修復，既有 SQL gate、歷史 migration 和 production plan 保持不變。這不是完整解除發布凍結：要驗證目標身分、備份復原、其他 runner、cron 及實際權限。HTTP POST 認證語意沿用現有實作，沒有新增權限。回退會恢復 unknown→DDL，不能當成安全復原。
