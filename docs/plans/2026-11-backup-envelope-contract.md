# 備份契約收斂：離線驗證基礎

## 根因與現況

盤點現有 `scripts/pre-migration-backup.sh`、#459、#466、#503 及既有 `docs/plans/2026-11-backup-consolidation.md` 草稿：週期備份、人工還原演練及 migration 前備份的目的不同，卻分別使用 repository variable、dispatch 輸入和 secret 取得相同用途的 age recipient，產物格式及 35／14／3 天保留也不一致。上傳成功或 `pg_restore --list` 均不等於能解密及還原。正式設定是否存在、正式來源／目標與復原點目前均未知。

## 決定與實作範圍

建議未來三者共同採 `vars.BACKUP_AGE_RECIPIENT` 作為 age X25519 **公開** recipient：密鑰輪替時同時檢查手動輸入及舊 secret，任何非空來源不一致時停止，不能靜默選一個。私鑰不放 GitHub、manifest 或日誌。recipient 必須先通過 age 實際加密驗證，正規表示式不是校驗和驗證。舊的 secret 設定不能在未確認 recipient 一致前移除或更改。

建議暫以每週備份 **35 天**（覆蓋至少四次週期）、人工演練 **14 天**（短期供複核）、migration 前 **3 天**（短期發布回滾用途）為各自 artifact 的最低預設；這三種用途不可互相取代，也不等於長期異地備份。這些值需再確認與 repository artifact 實際上限、災難恢復需求及私人金鑰保管相容，任何超出可設定上限均停止而不悄悄縮短。三者未經合成及正式可用性驗證前，不修改現有保留設定或啟用新排程。

新格式 v1 定義一個 age 加密 tar 包（其中存 custom pg_dump 與敏感明細），外部 manifest 僅允許固定欄位：用途、建立時間、密文檔名／大小／SHA-256、固定格式及保留天數。上傳後才取得 artifact ID 與 ZIP digest，須以獨立 receipt 綁定 manifest digest；ZIP digest 不可與密文 digest 混為一談。不要在 manifest、receipt 或日誌輸出資料庫 URL、真實逐表數量、資料或私鑰。現有 #459 多檔密文、#466 tar 密文、#503 單一 dump 密文都是 legacy 格式，不得假稱能直接用 v1 讀取；需保留舊讀取器及另外演練後再轉換。

本 PR 只新增純離線契約與驗證器，不接入、啟用或修改任何生產 workflow；不讀連線或正式環境設定，不備份、不修改資料、不建立身分。收到的密文 hash 與 manifest 只能證明兩份資料一致，不能證明上傳、真實來源、機密性、持有正確私鑰或可還原，更不是放行 migration 的授權。完整性與新鮮度分開：舊於建議保留期的備份仍可驗證／嘗試還原；新鮮度判斷必須由呼叫方明確給出時限，且不能代替來源身分或發布授權。必須另行驗證真實 source identity、TLS 憑證、recipient、上傳 receipt、失敗閘門、隔離還原、權限及備援策略。

## 驗收與限制

本機合成測試使用公開的 age 上游測試身分與虛構資料（絕不能用於正式系統），執行加密、密文雜湊與損毀失敗檢查；如可用隔離 PostgreSQL，將虛構資料 dump、加密、解密並還原到另一個不對外發布連接埠的容器。不存在的加密器或容器能力必須明確標示未驗證，不能以 mock 成功冒充。正式資料庫的 role/default ACL、擴充套件、Auth、Storage、Realtime 和平台設定不受此測試涵蓋。

在 repository 根目錄可執行 `scripts/backup/test-envelope-restore.sh`：傳入本機 `AGE_BIN`、`AGE_KEYGEN_BIN`，以及已下載的 age v1.2.1 公開 `testdata/example_keys.txt` 路徑 `AGE_PUBLIC_TEST_IDENTITY`。腳本固定核對該公開測試檔 SHA-256，拒絕其他身分，並使用本機已存在的 `postgres:17-alpine` image（不拉取 image），建立無網路、無 host port、tmpfs 的臨時容器。腳本沒有連正式資料庫或測試真實 artifact。損毀密文測試使用已改動的合成資料；尚未驗證錯誤私鑰、備份 workflow、雲端下載或正式還原。

## 參考做法

- [age v1.2.1](https://github.com/FiloSottile/age/tree/v1.2.1)（BSD-3-Clause）：公開 recipient、獨立離線私鑰與真正解密測試。
- [actions/upload-artifact v4.6.2](https://github.com/actions/upload-artifact/tree/v4.6.2)（MIT）：artifact ID 和 ZIP digest 在上傳後才能取得；不等於還原成功。
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)（PostgreSQL License）：清單檢查不等同實際還原。
- [Supabase 15.19/17.11 還原注意事項](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)：extension、自訂 operator 與 index 可能需額外處理。現有 #459/#466/#503 的持續相容性需在真實版本及權限資訊確認後重新檢查。
