# Scripts

## backup-db.ps1 — 資料庫備份

手動備份 Supabase 資料庫到本機，建議每週執行一次。

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

### 設定自動排程（Windows Task Scheduler）

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
