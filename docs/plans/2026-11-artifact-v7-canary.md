# Artifact v7 相容性合成驗證

- 問題：#489 擬更新上傳 Action，但現有發布與備份回復仰賴固定檔名、artifact ID、SHA-256、保存天數及 download-artifact v4；舊 PR CI 未執行這些上傳路徑。
- 盤點：檢查 `production-code-only.yml` 的 baseline／candidate 上傳與下載、`production-deploy-migrate.yml` 的備份 artifact、`scripts/pre-migration-backup.sh` 和 #503。保留所有正式 workflow 與原版本，不建立正式備份或資料庫連線。
- 方案：新增僅在 PR 執行的合成 canary，使用合成的 identity 與備份樣本，以固定 SHA 的 upload-artifact v7 預設壓縮，上傳後以目前 download-artifact v4 固定 SHA 按名稱取回。測試三個回傳的 ID 各不相同且格式有效、digest 格式有效，並核對下載後的檔名和各檔內容 SHA-256；`retention-days` 設為 7。兩個 artifact actions 使用 GitHub Actions 提供的同次 run 內部機制；workflow 全域 `permissions: {}`、不 checkout 或顯式取得 repository token，也沒有 `actions: read`、使用者 secrets、Vercel、資料庫、LINE 或正式 artifact。固定的合成資料生成及核對步驟直接寫在 workflow，離線測試會解析並執行相同步驟。
- 替代方案：僅對比 action.yml 的 inputs/outputs，不足以測試 GitHub 實際上傳與跨 job 下載；直接更新正式 workflow 則會讓回復路徑在相容性未驗證前改版。
- 限制：不查 artifact metadata，因此無法驗證服務端的實際到期時間、回傳的 ID 是否對應預期名稱，或上傳 digest 是否與服務端 ZIP 一致；七日僅為設定輸入，可能受 repository 政策限制。此 canary 只驗證合成資料與同一 run 的 artifact，不證明正式備份來源、加密金鑰、PostgreSQL/Supabase 還原或所有日後 artifact 均可用。現行固定的 download-artifact v4 對 digest mismatch 只發 warning；合成檔案內容檢查不會改變正式 recovery 的行為。`archive: false` 會改變單檔命名，因此本測試不使用。
- 上線：先在 PR 確認 canary 與獨立審查，與正式部署分開；#489 和 #485 仍須追蹤。此 PR 可直接回復，不影響正式資料或現有 artifact。

## 參考做法

- [actions/upload-artifact v7.0.2](https://github.com/actions/upload-artifact/tree/v7.0.2)（MIT）：預設 archive、提供 ID/digest；Node 24 需支援的 runner。
- [actions/download-artifact v4.3.0](https://github.com/actions/download-artifact/tree/v4.3.0)（MIT）：沿用正式回復所固定的版本，並以合成內容額外核對實際結果。
- 根因是版本升級橫跨 artifact 產生、上傳及下載契約；透過隔離合成工作流程取得相容性證據，而不是推論備份可還原。
