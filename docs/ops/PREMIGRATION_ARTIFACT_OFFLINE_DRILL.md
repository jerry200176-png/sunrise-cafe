# 既有 3 天 pre-migration artifact：使用者本機隔離還原演練包

**待使用者執行；本次沒有下載、解密或接觸任何正式 artifact、私鑰或正式資料。** 目標是在你自行控制的工作站，核對一份現有密文能否被既有私鑰解密，並把 dump 還原到全新、無網路的暫存 PostgreSQL。成功只證明該樣本經驗證 ZIP、解密雜湊與 PostgreSQL restore；**不代表正式來源身分、逐筆完整性、異地備援或完整 Supabase 恢復已驗證，也不解除正式發布暫停**。

## 支援與阻擋

本工具僅支援 main 上 `scripts/pre-migration-backup.sh` 的現有 legacy 產物：GitHub ZIP 內根目錄恰有 `manifest.json` 和 `sunrise-cafe_predeploy_<UTC>.dump.age` 或 `sunrise-cafe_postdeploy_<UTC>.dump.age`；manifest 為 `encrypted: true`、`schema: public`、`format: pg_dump custom`，內含明文 dump 的原始 SHA-256 和 byte 數。它**不是**新建議的 v1 加密 tar 信封；#459 多檔 artifact、#466 加密 tar 或其他格式不可混用。

必須先獨立確認 artifact 對應正確 repository、成功的 main 正式部署 run、正確 pre/postdeploy 階段及未過期。manifest 自身不包含可證明資料庫身分的可靠憑證；若無法建立這些證據，停止，不以檔名推論。ZIP 的可信 SHA-256 必須由 GitHub artifact API／介面獨立取得；若 `digest` 不存在、無法核對或是其他檔案的 digest，停止。ZIP digest 與 manifest 內 **明文 dump** 的 SHA-256 是兩個不同摘要，不可互換；二者一致性也不是獨立簽章。

需要你自己持有能解密該份 artifact 的 age 私鑰檔，保存在你控制的本機；不貼到聊天、issue、PR、指令或環境變數，不上傳、不複製進容器。腳本只互動式讀取**絕對檔案路徑**，不顯示路徑或金鑰內容；拒絕 `.env*`、`.ssh`、`.aws` 路徑、任一層 symbolic link 以及有多個 hardlink 的檔案。檔案以 Linux `O_NOFOLLOW`／逐層 dirfd 開啟後保留 descriptor 使用，避免檢查完再從原路徑開啟時被替換；仍須使用可信的單使用者工作站，不能防止同一身分的程式直接修改既有檔案內容或讀取程序記憶體。若找不到可用私鑰，不要建立新金鑰期待能解開舊資料。若 GitHub 權限、artifact 保存期或私鑰保管狀態無法確認，先停止並處理該障礙。

在可信任、具足夠記憶體的 Linux 工作站，預先確認 `age`、Python 3、`sha256sum`、Docker 可用，以及已審核且適合該 dump 的本機 `postgres:17-alpine` image；工具使用 `--pull=never`，不自行下載 image。所有 Docker 呼叫均忽略 `DOCKER_HOST`／`DOCKER_CONTEXT`、使用空白臨時 client config，並強制連接 root 擁有的 `/var/run/docker.sock`；你仍須確認該 socket 與 daemon 實際屬本機、沒有被代理至遠端，且主機與 daemon 可信。socket 形態和擁有者本身不能證明 daemon 沒有轉送流量。若無法確認，請停止。實際資料庫版本、extensions、owner/default ACL 不明時，還原可能失敗；不應加入 `--no-privileges` 或以放寬角色權限掩蓋失敗。啟用磁碟與 swap 加密或使用不交換到磁碟的安全環境：tmpfs 和管線仍可能受作業系統 swap／快照影響，不能保證安全抹除。

## 由使用者操作

也可使用 `scripts/backup/wsl-restore.py` 這個單檔互動封裝。先由可信來源取得並獨立核對該封裝的 SHA-256，再以四個**非秘密**參數呼叫：

```bash
python3 /path/to/verified-wsl-restore.py \
  /absolute/path/to/reviewed-source.zip \
  /absolute/path/to/encrypted-artifact.zip \
  INDEPENDENT_ARTIFACT_ZIP_SHA256 \
  EXPECTED_POSTGRES_MANIFEST_SHA256
```

兩個摘要均為不含 `sha256:` 的 64 位小寫十六進位。備份 ZIP 摘要必須由 GitHub artifact metadata 獨立取得；映像 manifest 摘要須事先由可信來源確認，程式只比較輸入值與本機 RepoDigest，不能單靠此比較證明官方身分。封裝會固定核對四個已審 helper SHA；加入 `btree_gist` 相容修正後，舊 `9dd2a46` source ZIP 的 worker 不再吻合，須下載包含新版 worker 的已審 source ZIP，否則在要求私鑰前停止。

封裝在要求私鑰前，檢查四個 helper、密文 ZIP 摘要、kernel 回報的 `/dev/shm` 檔案系統類型、本機 Unix socket 與 image digest，也會設定程序 core size 為 0 並關閉程序 dumpable；任一檢查失敗均不要求私鑰。成功後才透過控制終端隱藏輸入**單行 age X25519 私鑰**；非互動終端或無法關閉回顯會停止。私鑰短暫寫入 `/dev/shm` 內私有 0700 目錄與 0600 檔案；正常、失敗、Ctrl-C、TERM 及終端關閉的 SIGHUP 會嘗試清理，但 SIGKILL、斷電、swap 和同使用者程序存取不在保證範圍。`exec` 後 dumpable 可能重置，且系統 core dump pipe handler 可能繞過程序 core size 限制：你仍須在可信工作站先確認系統不會收集／轉送程序記憶體及 core dump，Python 不保證清除所有記憶體副本。helper 仍會在 `/tmp` 暫存並刪除**加密 ZIP 副本與 manifest**，不刻意把明文寫到 host 檔案。

隔離工具失敗時，封裝只將既有 helper 的單一、完全吻合白名單的固定訊息映射成固定中文階段提示，不輸出原始 stdout、stderr、私鑰、SQL、客戶資料或檔案路徑。其他文字、額外行或多種訊息一律顯示「無法根據固定訊息判定失敗階段」；Docker 命令本身或角色初始化若沒有固定標記也會落入未知。階段提示只供排查，不能據此斷定根因或解除發布暫停。

已審 helper 的 `docker run` 使用 `postgres:17-alpine` **可變 tag**；封裝前後比較 image ID，不能排除同一可信主機上的程序在兩次檢查間短暫替換 tag 後再換回。只應在你確認的單使用者本機 Docker Desktop、執行期間沒有其他程序變更 tag 時使用；需要消除該競態時，必須先修訂並重新審查 helper，不能聲稱目前已用 immutable image ID 啟動。

1. 在 GitHub Actions 找到可信且仍保留的正式部署 run，確認 artifact 名稱、run 與階段；不要上傳其內容。若使用已登入且具對應權限的 GitHub CLI，可在自己的 shell 查閱該 run 的 artifact metadata（替換你自行確認的 RUN_ID）：

   ```bash
   gh api "repos/jerry200176-png/sunrise-cafe/actions/runs/RUN_ID/artifacts" \
     --jq '.artifacts[] | {id,name,expired,digest,expires_at}'
   ```

   確認該 artifact 未過期、`digest` 格式為 `sha256:<64 位小寫十六進位>`；記下與同一 artifact ID 對應的 digest。若不可用，停止並先解決 GitHub 權限或可信摘要來源，不要從待驗證 ZIP 自己算一份摘要當作獨立證據。

2. 由該 artifact 的 GitHub 頁面或已驗證的 GitHub CLI 下載 **ZIP** 到你的受控本機目錄，確認檔案對應前一步選擇的 ID。下載及其訪問紀錄受 GitHub 權限與保留期限控制；不要放到分享資料夾。這步會接觸真實密文，因此由你執行；若你尚未同意下載或無權存取，就停在此處。

3. 在已審閱的程式庫 checkout 根目錄執行：

   ```bash
   bash scripts/backup/restore-legacy-local.sh
   ```

   依提示輸入：本機 ZIP 絕對路徑、步驟 1 獨立取得的 `sha256:...` digest、你本機 age 私鑰**檔案絕對路徑**。不輸入私鑰內容。腳本先將密文 ZIP 複製到 mode 0700 暫存目錄並驗 ZIP digest，只允許上述兩個普通檔案、固定檔名、有效 manifest 與有足夠空間的安全解壓。完成後先串流解密並檢查明文長度與 manifest SHA-256，再串流至 `--network none`、`--log-driver=none`、唯讀根檔案系統、無 host port／bind mount、資料目錄與還原日誌皆為 tmpfs 的拋棄式 PostgreSQL 容器。工具先由原 archive 的單一 public schema 目錄項建立 schema，再於其中建立映像內 `btree_gist`，最後按原順序還原其餘項目；每個還原階段各自使用 `--exit-on-error --single-transaction`，不是跨階段的一個交易，失敗會銷毀容器。整個封裝只需輸入一次私鑰。Docker 日誌不得另行開啟、留存或轉送。

4. 工具在自己的空容器建立固定 no-login role stub 並移除容器的空 `public` schema；對正式資料庫沒有連線路徑。任意角色、extension、權限或還原錯誤一律停止，還原細節只留在容器 tmpfs 且結束時刪除，不會直接顯示可能包含敏感內容的錯誤。要進一步排查請先由使用者在受控環境安排安全的資料與權限審閱，不要貼出未遮蔽 log。

5. 正常結束、Ctrl-C 或 TERM 時，腳本會嘗試停止並移除它建立的容器，刪除自身隨機暫存目錄中的 ZIP 副本和解出的密文／manifest；**原始下載 ZIP 與本機私鑰由你保管，不會被修改或刪除**。明文經 pipe 直接進入容器，沒有刻意寫入 host 檔案；容器 tmpfs 被移除不代表主機 swap 或快照可安全抹除。強制終止、Docker 服務中斷或當機可能令清理不完整；請自行檢查名為 `sunrise-legacy-drill-*` 的殘留，確認屬於此次操作後再移除。

## 驗收與後續

成功訊息只表示 ZIP digest 與 manifest dump 雜湊吻合、使用者本機私鑰可解密、隔離 PostgreSQL 中 restore 未報錯且 `public.reservations` 存在。`public.btree_gist` 是依目前唯讀 schema 證據為隔離目標額外準備，**不是從這份 archive 證實原備份當時包含該 extension**；準備失敗或其他依賴缺失都停止。這個相容性缺口是目前的測試假說，不能推論先前實際失敗原因。**沒有**與來源逐表／逐列對照，沒有驗證 RLS／ACL 對實際應用等價，也沒有完整還原 Auth users、Storage objects、roles、Realtime、extensions 或 Supabase 專案設定；仍需依據已批准的復原策略與實際 source/target 身分進一步驗證。若步驟失敗，只回報失敗階段和已遮蔽的環境資訊，不傳檔案、金鑰或原始 log。

該離線工具只用虛構 dump 與上游公開 age 測試身分測試過。它尚未對任何真實 artifact 執行；安全、權限、digest 可用性、image 版本及實際 source 自訂 roles/extension 仍需由你確認。
