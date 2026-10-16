# Runbook — 雲端資料庫備份（GitHub Actions + age）

> Founder 決定 2026-10-15：不買 Supabase 付費方案；資料庫備份從 Jerry 的電腦
> （`scripts/backup-db.ps1` + Windows 工作排程器）搬到 GitHub Actions。
> Workflow：[`.github/workflows/backup-db.yml`](../.github/workflows/backup-db.yml)
> （不變條件由 `src/lib/backup-db-workflow.test.ts` 在 CI 檢查）

## 它做什麼

| 項目 | 內容 |
|---|---|
| 排程 | 每週六 19:10 UTC＝**週日 03:10 台北**；也可手動 `workflow_dispatch`（只在 `main` 跑） |
| 來源 | 既有 repository secret **`SUPABASE_DB_URL`**（與 `production-deploy-migrate.yml` 同一個），唯讀 `pg_dump` |
| 連線 | URL 在 workflow 內解析、**不放在命令列、不印出**；密碼／使用者／主機／整串 URL 都先 `::add-mask::`；libpq 只拿 `PGHOST`／`PGPORT`／`PGUSER`／`PGDATABASE`／`PGSSLMODE=require` 加上 `RUNNER_TEMP` 裡 0600 的 `PGPASSFILE`（step 結束後刪除）；`psql`／`pg_dump` 的 stderr 經過遮蔽過濾 |
| 範圍 | `public` schema（所有 app 資料表都在這裡），`pg_dump --format=custom` |
| 客戶端 | PGDG `postgresql-client-17`（`pg_dump` 必須 ≥ 伺服器主版本；workflow 會先查 `server_version_num`，伺服器比較新就直接失敗） |
| 加密 | [age](https://age-encryption.org) **公鑰**加密；公鑰來自 repository **variable** `BACKUP_AGE_RECIPIENT`。私鑰永遠不進 GitHub |
| 產物 | Actions artifact `sunrise-cafe-db-backup-<UTC 時間>`，保留 **35 天（每週一份，約留 5 份）**：`*.dump.age`、`*.rowcounts.tsv.age`（各表筆數）、`*.meta.tsv.age`（extension 清單與 Realtime publication 成員）、`SHA256SUMS`、`manifest.json`（只有大小、雜湊、表數、policy 數） |
| 失敗即停 | `BACKUP_AGE_RECIPIENT` 沒設、空白、不是 `age1…`、或 age 不接受 → **在碰資料庫之前**失敗；`SUPABASE_DB_URL` 沒設、是範本、格式錯、percent-encoding 錯 → 以固定錯誤碼（`DB_URL_MISSING`／`DB_URL_PLACEHOLDER`／`DB_URL_MALFORMED`／`DB_URL_BAD_ENCODING`）失敗，不顯示值 |
| 明文 | 只存在 runner 的 `$RUNNER_TEMP`（權限 0700），加密後立刻刪除；上傳前檢查目錄裡只有 `.age`／`SHA256SUMS`／`manifest.json` |
| Log | repo 是**公開**的：log 只印大小與表數，不印任何資料 |

> 為什麼 35 天：每週跑一次，35 天可同時保留約 5 份，一次排程延遲或失敗不會讓備份歸零。
> repo 公開，任何登入 GitHub 的人都能下載 artifact，但內容是 age 密文，沒有私鑰打不開。
> 要更長期保存，Founder 每月下載一份到離線位置（見下方「長期保存」）。

## Founder 一次性設定

0. **確認 `SUPABASE_DB_URL` secret 是真的連線字串**。其他 workflow 有「secret 是 `[region]` 範本時改從 Vercel 讀」的備援，
   代表這個 secret 可能還是範本；這個備份 workflow **刻意不做**這個備援，第一次跑可能會以 `DB_URL_PLACEHOLDER` 失敗（預期的 fail closed）。
   到 Supabase Dashboard → Connect 複製 **Session pooler**（port 5432）的 URI，更新 repo secret `SUPABASE_DB_URL`。
   GitHub runner 沒有 IPv6，`db.<ref>.supabase.co` 直連可能連不上；Transaction pooler（6543）不適合 `pg_dump`。
   這個 secret 也被 `production-deploy-migrate.yml` 使用，更新前先確認新值同樣適用於 migration。
1. **在信任的電腦上產生金鑰**（不要在雲端或 Codespaces）：
   ```bash
   age-keygen -o backup.key
   ```
   畫面會印出 `Public key: age1…`。把 `backup.key` **離線保存兩份**（例如：加密 USB ＋ 密碼管理器的安全附件）。
   遺失 `backup.key` = 所有備份都打不開。
2. **設定公鑰**：GitHub → repo Settings → Secrets and variables → Actions → **Variables** 分頁 →
   New repository variable：名稱 `BACKUP_AGE_RECIPIENT`，值貼上 `age1…` 公鑰。
   公鑰**不是秘密**，可以分享；不要放進 Secrets（放 Secrets 的話 workflow 讀不到，會失敗）。
3. **手動跑一次**：Actions → *DB backup (encrypted)* → Run workflow（branch：`main`）。
   成功後 run summary 會顯示 artifact 名稱、SHA-256、明文／密文大小、表數、RLS policy 數。
4. **還原演練**（只在本機 Docker 的拋棄式資料庫做，**絕不**還原到正式環境）：
   ```bash
   gh run download <run-id> -R jerry200176-png/sunrise-cafe -D drill
   bash scripts/restore-drill-cloud-backup.sh drill/sunrise-cafe-db-backup-*/ /path/to/backup.key
   ```
   腳本會：
   1. `sha256sum -c SHA256SUMS`，用私鑰 `age -d` 解密到暫存目錄；
   2. 啟動拋棄式 `postgres:17` 容器（預設，最安全）；或用 `LOCAL_DSN=` 指定本機**空的**拋棄式 DB（client 需 ≥ 17）。
      `LOCAL_DSN` 模式會 `DROP SCHEMA public CASCADE`，所以腳本只接受 loopback（`127.0.0.1`／`localhost`／`::1`）
      或 Unix socket、拒絕 `service=`／`hostaddr=`、清掉呼叫端的 `PG*` 環境變數、必須設
      `I_UNDERSTAND_THIS_DROPS_LOCAL_DATA=1`，而且目標 `public` 已有任何資料表就拒絕（每次演練用新的空 DB）；
   3. 先建立 Supabase 角色 `anon`／`authenticated`／`service_role`、`extensions` schema、
      **`btree_gist`**（`reservations_no_overlap_excl` 防重複訂位需要），以及 `meta.tsv` 記錄的其他 extension
      （Supabase 專屬的會警告略過）；
   4. `DROP SCHEMA public CASCADE` 後 `pg_restore --exit-on-error --no-owner --no-privileges`（任何 DDL 失敗都會中止）；
   5. 檢查：`reservations_no_overlap_excl` 存在、`reservations` 有啟用 RLS、還原後的 policy 數＝dump 內的 policy 數、
      每張表筆數＝`rowcounts.tsv`；
   6. 印出要重建的 Realtime publication 指令。

   全部通過才會印 `DRILL_RESULT=pass`；結束時自動刪除容器與解密後的明文。

   > **Realtime publication 不在備份裡**：`--schema=public` 不包含 `supabase_realtime` 的成員。
   > 真的要還原到新的 Supabase 專案時，還原後要依 `meta.tsv`（或腳本印出的清單）執行，例如
   > `ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;`、`… ADD TABLE public.orders;`，
   > 否則後台即時更新會停。
   >
   > **真正復原 ≠ 演練**：還原到新的 Supabase 專案時**不要**加 `--no-privileges`（要保留給 `anon`／`service_role`
   > 的 GRANT 與 RPC 的 EXECUTE 權限）。正式環境的任何還原都需 Founder 批准。
5. **確認上面都成功後**，停用 Windows 工作排程器裡跑 `backup-db.ps1` 的工作（停用或刪除該工作即可）。

## 長期保存（建議）

artifact 保留 35 天（約 5 份週備份）。建議每月把一份 `.age` 檔下載到離線位置（加密檔，放雲端硬碟也可以）。
要改保留天數或頻率，改 workflow 的 `retention-days` 與 `cron`，走 PR（contract test 要求 28–90 天）。

## 疑難排解

| 現象 | 原因／處理 |
|---|---|
| `BACKUP_AGE_RECIPIENT is missing or empty` | 第 2 步沒做，或放到 Secrets 而不是 Variables |
| `age rejected BACKUP_AGE_RECIPIENT` | 貼錯值；必須是完整 `age1…` 一行 |
| `DB_URL_PLACEHOLDER` | secret 內容是範本（含 `[region]` 等），見第 0 步 |
| `DB_URL_MALFORMED`／`DB_URL_BAD_ENCODING` | secret 不是 `postgresql://user:password@host:port/db`，或密碼中的特殊字元沒有正確 percent-encode（例如 `@` → `%40`）。主機必須是名稱（Supabase pooler 都是），IPv6 位址字面值（`[…]`）不支援 |
| `PG_CLIENT_FAILED` | 連線或 dump 失敗；上方 stderr 已遮蔽 URL／主機／使用者。常見原因：Supabase 免費方案閒置 7 天暫停（到 Dashboard 恢復後重跑）、用了直連 IPv6 主機 |
| `Server major N is newer than pg_dump 17` | Supabase 升級了 Postgres；把 workflow 的 `PG_CLIENT_MAJOR` 改成 N |
| 演練 `reservations_no_overlap_excl missing` | `btree_gist` 沒建好，或 dump 不完整；不得當作通過 |

## 範圍限制

- 只備份資料庫 `public` schema；Supabase Storage 裡的檔案（例如菜單照片）不在備份內，資料表中的圖片網址在專案遺失時會失效。
- extension 與 Realtime publication 只記錄在 `meta.tsv`，不會自動還原（見上）。
- `rowcounts.tsv` 與 dump 是同一次 run 先後取得，不是同一個 snapshot；03:10 幾乎沒有寫入，差異應為 0。

## 後續（需要 Founder 決定，不在本 PR）

目前 job 用的是 repo 層級、具 migration 權限的 `SUPABASE_DB_URL`。把它單獨移到某個 environment 並不會降低暴露
（同一個 secret 仍在 repo 層級供 `production-deploy-migrate.yml` 使用）。真正的改善是：
建立唯讀的 `backup_ro` 角色（`pg_read_all_data` 或 `SELECT` + `BYPASSRLS`，需要 SQL），把它的 URL 放進只允許 `main` 的
`db-backup` environment secret，再讓這個 job 加上 `environment: db-backup`。追蹤：#461。

## 回滾

刪除 `.github/workflows/backup-db.yml`（或在 Actions 停用該 workflow）。不影響正式環境；
舊的 `scripts/backup-db.ps1`／`backup-db.sh` 仍在 repo，可暫時回到本機備份。
