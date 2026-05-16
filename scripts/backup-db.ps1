# Supabase 資料庫備份腳本
# 使用方式：在 PowerShell 執行 .\scripts\backup-db.ps1
# 需要先安裝 PostgreSQL client（pg_dump）：https://www.postgresql.org/download/windows/
#
# 設定方式：
# 1. 複製 .env.local，從 Supabase Dashboard → Settings → Database → URI 取得連線字串
# 2. 將連線字串設為環境變數 SUPABASE_DB_URL，或直接在下方填入

param(
    [string]$OutputDir = "$PSScriptRoot\..\backups",
    [int]$KeepDays = 30
)

# 從環境變數讀取，或提示輸入
$dbUrl = $env:SUPABASE_DB_URL
if (-not $dbUrl) {
    Write-Error "請設定環境變數 SUPABASE_DB_URL，格式：postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
    exit 1
}

# 建立備份目錄
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# 備份檔名含時間戳記
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outputFile = Join-Path $OutputDir "sunrise-cafe_$timestamp.sql"

Write-Host "開始備份資料庫..." -ForegroundColor Cyan
Write-Host "輸出路徑：$outputFile"

# 執行 pg_dump
try {
    & pg_dump $dbUrl --no-password --format=plain --file=$outputFile 2>&1
    if ($LASTEXITCODE -ne 0) { throw "pg_dump 執行失敗（exit code $LASTEXITCODE）" }

    $size = (Get-Item $outputFile).Length / 1KB
    Write-Host "備份完成！檔案大小：$([math]::Round($size, 1)) KB" -ForegroundColor Green
} catch {
    Write-Error "備份失敗：$_"
    exit 1
}

# 刪除超過保留天數的舊備份
$cutoff = (Get-Date).AddDays(-$KeepDays)
$old = Get-ChildItem $OutputDir -Filter "sunrise-cafe_*.sql" | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old.Count -gt 0) {
    $old | Remove-Item
    Write-Host "已刪除 $($old.Count) 個超過 $KeepDays 天的舊備份" -ForegroundColor Yellow
}

Write-Host "完成。備份保留最近 $KeepDays 天。" -ForegroundColor Cyan
