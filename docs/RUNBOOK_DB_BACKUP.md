# Runbook — 雲端資料庫備份（GitHub Actions + age）

> Founder 決定 2026-10-15：不買 Supabase 付費方案；資料庫備份從 Jerry 的電腦
> （`scripts/backup-db.ps1` + Windows 工作排程器）搬到 GitHub Actions。
> Workflow：[`.github/workflows/backup-db.yml`](../.github/workflows/backup-db.yml)

## 它做什麼

| 項目 | 內容 |
|---|---|
| 排程 | 每週六 19:10 UTC＝**週日 03:10 台北**；也可手動 `workflow_dispatch`（只在 `main` 跑） |
| 來源 | 既有 repository secret **`SUPABASE_DB_URL`**（與 `production-deploy-migrate.yml` 同一個），唯讀 `pg_dump` |
| 範圍 | `public` schema（所有 app 資料表都在這裡），`pg_dump --format=custom` |
| 客戶端 | PGDG `postgresql-client-17`（`pg_dump` 必須 ≥ 伺服器主版本；workflow 會先查 `server_version_num`，伺服器比較新就直接失敗） |
| 加密 | [age](https://age-encryption.org) **公鑰**加密；公鑰來自 repository **variable** `BACKUP_AGE_RECIPIENT`。私鑰永遠不進 GitHub |
| 產物 | Actions artifact `sunrise-cafe-db-backup-<UTC 時間>`，保留 **7 天**：`*.dump.age`、`*.rowcounts.tsv.age`（各表筆數，供還原演練比對）、`SHA256SUMS`、`manifest.json`（只有大小、雜湊、表數） |
| 失敗即停 | `BACKUP_AGE_RECIPIENT` 沒設、空白、不是 `age1…`、或 age 不接受 → **在 dump 之前**失敗；`SUPABASE_DB_URL` 沒設或是 placeholder → 失敗 |
| 明文 | 只存在 runner 的 `$RUNNER_TEMP`（權限 0700），加密後立刻 `shred`；上傳前檢查目錄裡只有 `.age`／`SHA256SUMS`／`manifest.json` |
| Log | repo 是**公開**的：log 只印大小與表數，不印任何資料 |

> 為什麼只保留 7 天：repo 公開，任何登入 GitHub 的人都能下載 artifact。檔案是加密的，但仍縮短暴露時間。
> 要長期保存，Founder 每月下載一份到離線位置（見下方「長期保存」）。

## Founder 一次性設定

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
   成功後 run summary 會顯示 artifact 名稱、SHA-256、明文／密文大小、表數。
4. **還原演練**（只在本機或 Docker 的拋棄式資料庫做，**絕不**還原到正式環境）：
   ```bash
   # 下載 artifact（或在 Actions 頁面點下載後解壓）
   gh run download <run-id> -R jerry200176-png/sunrise-cafe -D drill
   cd drill/sunrise-cafe-db-backup-*/
   sha256sum -c SHA256SUMS

   age -d -i /path/to/backup.key -o backup.dump  sunrise-cafe_*.dump.age
   age -d -i /path/to/backup.key -o rowcounts.tsv sunrise-cafe_*.rowcounts.tsv.age

   # 拋棄式 Postgres 17
   docker run -d --name drill-pg -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:17
   export LOCAL_DSN='postgresql://postgres:drill@127.0.0.1:55432/postgres'
   # dump 內含 CREATE SCHEMA public，先清掉預設的 public
   psql "$LOCAL_DSN" -c 'DROP SCHEMA public CASCADE'
   pg_restore -d "$LOCAL_DSN" --no-owner --no-privileges backup.dump

   # 比對筆數
   while IFS=$'\t' read -r t n; do
     printf '%s\t%s\t%s\n' "$t" "$n" "$(psql "$LOCAL_DSN" -XAtc "SELECT count(*) FROM public.\"$t\"")"
   done < rowcounts.tsv
   ```
   每列第二、三欄應相同。`--no-owner --no-privileges` 會略過 Supabase 專屬角色
   （`anon`／`authenticated`／`service_role`）的授權；若 RLS policy 引用了這些角色或 `auth.*`
   函式而出現錯誤，先 `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`
   再重來，或改用 `supabase/postgres` image。資料筆數一致即算演練通過。
   演練完：`docker rm -f drill-pg`，並刪除 `backup.dump`／`rowcounts.tsv` 明文。
5. **確認上面都成功後**，停用 Windows 工作排程器裡跑 `backup-db.ps1` 的工作（停用或刪除該工作即可）。

## 長期保存（建議）

artifact 只留 7 天。建議每月把一份 `.age` 檔下載到離線位置（加密檔，放雲端硬碟也可以）。
要改保留天數或頻率，改 workflow 的 `retention-days` 與 `cron`，走 PR。

## 疑難排解

| 現象 | 原因／處理 |
|---|---|
| `BACKUP_AGE_RECIPIENT is missing or empty` | 第 2 步沒做，或放到 Secrets 而不是 Variables |
| `age rejected BACKUP_AGE_RECIPIENT` | 貼錯值；必須是完整 `age1…` 一行 |
| `SUPABASE_DB_URL looks like a placeholder` | secret 內容是範本（含 `[region]`）。到 Supabase Dashboard → Connect 複製 **Session pooler**（port 5432）連線字串更新 secret。GitHub runner 沒有 IPv6，`db.<ref>.supabase.co` 直連可能連不上；Transaction pooler（6543）不適合 `pg_dump` |
| `Server major N is newer than pg_dump 17` | Supabase 升級了 Postgres；把 workflow 的 `PG_CLIENT_MAJOR` 改成 N |
| 連線逾時 | Supabase 免費方案閒置 7 天會暫停，到 Dashboard 恢復後重跑 |

## 範圍限制

- 只備份資料庫 `public` schema；Supabase Storage 裡的檔案（例如菜單照片）不在備份內。
- `rowcounts.tsv` 與 dump 是同一次 run 先後取得，不是同一個 snapshot；03:10 幾乎沒有寫入，差異應為 0。

## 回滾

刪除 `.github/workflows/backup-db.yml`（或在 Actions 停用該 workflow）。不影響正式環境；
舊的 `scripts/backup-db.ps1`／`backup-db.sh` 仍在 repo，可暫時回到本機備份。
