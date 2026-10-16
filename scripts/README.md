# Scripts

## 資料庫備份 — 現行：GitHub Actions（2026-10-15 起）

每週自動備份改由 [`.github/workflows/backup-db.yml`](../.github/workflows/backup-db.yml) 執行
（age 公鑰加密、artifact 保留 35 天≈5 份週備份；還原演練用 `scripts/restore-drill-cloud-backup.sh`）。設定、還原演練與停用本機排程的步驟見
[`docs/RUNBOOK_DB_BACKUP.md`](../docs/RUNBOOK_DB_BACKUP.md)。

## backup-db.ps1 — 資料庫備份（legacy）

> **Legacy（2026-10-15）**：已由 GitHub Actions `backup-db.yml` 取代。完成 runbook 的還原演練後，
> 請停用 Windows 工作排程器的這個工作。以下內容只保留作為臨時本機備份的參考。
> `backup-db.sh`（`npm run db:backup`）同樣是本機用的 legacy 工具。

手動備份 Supabase 資料庫到本機。

### 前置需求

安裝 PostgreSQL client（只需要 pg_dump，不需要完整 PostgreSQL）：
- 下載：https://www.postgresql.org/download/windows/
- 安裝時只勾選「Command Line Tools」即可
- 確認可執行：`pg_dump --version`

### 設定連線字串

1. 登入 [Supabase Dashboard](https://supabase.com) → 你的專案
2. Settings → Database → **Connection string** → 選 **URI**
3. 複製連線字串（格式：`postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`）
4. 在 PowerShell 設定環境變數：

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres:你的密碼@db.你的專案ID.supabase.co:5432/postgres"
```

### 執行備份

```powershell
# 備份到預設路徑（專案根目錄 /backups/）
.\scripts\backup-db.ps1

# 指定輸出目錄
.\scripts\backup-db.ps1 -OutputDir "D:\Backups\SunriseCafe"

# 保留 60 天備份
.\scripts\backup-db.ps1 -KeepDays 60
```

備份檔案格式：`sunrise-cafe_20260516_200000.sql`

### 設定自動排程（Windows Task Scheduler，legacy — 已不需要）

1. 開啟「工作排程器」
2. 建立基本工作 → 每週一觸發
3. 動作：啟動程式
   - 程式：`powershell.exe`
   - 引數：`-File "C:\Users\jerry\專案\Sunrise_Cafe\scripts\backup-db.ps1"`
   - 記得先在系統環境變數設定 `SUPABASE_DB_URL`

### 還原備份

```powershell
psql $env:SUPABASE_DB_URL -f "backups\sunrise-cafe_20260516_200000.sql"
```

> ⚠️ 還原前請先在 Supabase Dashboard 清空相關資料表，避免主鍵衝突。
