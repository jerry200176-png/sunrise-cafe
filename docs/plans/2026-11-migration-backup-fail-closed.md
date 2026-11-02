# Migration 留存備份 fail closed（#485）

根因：腳本容許缺少加密 recipient 成功完成並輸出 encrypted=false；workflow 以此跳過上傳與檢查仍執行 migration。另兩個名為 verify 的 job 實際重新執行會寫入的 phase runner，不能假定唯讀。搜尋 `BACKUP_AGE_RECIPIENT`、`pre-migration-backup`、`run-production-migration-phase`：沿用原 dump/pg_restore 驗證、age 加密、現有 settlement 的 manifest/assertRecoveryPoint、GitHub artifact，上述四個 runner job 都須受同一條備份鏈保護；不建立第二個備份平台。#459/#466 是例行備份及 restore 演練，非此 deploy gate。

方案：missing recipient 在 dump 前拒絕；age 不可用、加密失敗或 ciphertext 缺失均拒絕且清除明文；upload 無檔、失敗或未輸出有效 artifact ID/digest 必須終止當前 job。四個執行 phase runner 的 job 各建立當前 job 的獨立備份及上傳證據，runner 執行入口再重用既有 freshness、manifest、artifact 檢查以 fail closed；只驗證 plan 的 `--check` 不操作資料庫，無需備份。相比只改 workflow 條件，此方案也涵蓋實際可寫的 verify jobs 和 runner 被錯誤呼叫。不得更改或假設正式 recipient 配置；沒有設定時預期正式 migration/deploy 停止。

測試：僅以合成 dump、假的 age 與 artifact 事件，驗證缺 key、pg 失敗、加密失敗、upload 失敗／缺 ID、success metadata 與各 job 鏈順序，未讀憑證或連正式服務。密文上傳成功及 digest 是留存證據，不能證明可還原；下載、解密、隔離 restore 為獨立演練。rollback 必須由審查確認，不能恢復允許無備份 migration 的舊行為。

## 參考做法
- [GitHub actions/upload-artifact v4.6.2](https://github.com/actions/upload-artifact/tree/v4.6.2)（MIT）：`if-no-files-found: error`、artifact ID 與 SHA-256 digest；使用固定 commit，不把成功輸出當作 restore 證明。
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)（PostgreSQL License）：custom archive 的 list 可檢查可解析目錄，但需要 restore 測試才能驗證可復原。
- 根因是缺少強制加密和可留存證據及可寫 verify 旁路；刪除警告或只改顯示文字不能建立 recovery point。
