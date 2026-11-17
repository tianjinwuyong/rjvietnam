# SMT Factory System - Export Script
# Run on SOURCE computer before migration

param(
    [string]$BackupPath = "C:\backup",
    [string]$ProjectPath = "C:\Users\tianj\Desktop\越南工厂瑞晶"
)

$ErrorActionPreference = "Stop"

Write-Host "=== SMT Factory Export Script ===" -ForegroundColor Cyan

# 1. Create backup directory
Write-Host "`n[1/4] Creating backup directory..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $BackupPath | Out-Null

# 2. Export PostgreSQL database
Write-Host "`n[2/4] Exporting database..." -ForegroundColor Yellow
$env:PGHOST = "127.0.0.1"
$env:PGPORT = "5432"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "postgres"
$env:PGDATABASE = "smt_factory"

$dumpFile = Join-Path $BackupPath "smt_factory.dump"
pg_dump -F custom -f $dumpFile $PGDATABASE
if ($LASTEXITCODE -eq 0) {
    $size = (Get-Item $dumpFile).Length / 1MB
    Write-Host "  Database exported: $size MB" -ForegroundColor Green
}

# 3. Export project files
Write-Host "`n[3/4] Exporting project files..." -ForegroundColor Yellow
$projectZip = Join-Path $BackupPath "smt-factory-system.zip"
$smtPath = Join-Path $ProjectPath "smt-factory-system"

# Use 7z if available, otherwise use Compress-Archive
$sevenZip = "C:\Program Files\7-Zip\7z.exe"
if (Test-Path $sevenZip) {
    # Use 7z for better compression and faster speed
    & $sevenZip a -tzip -mx=9 $projectZip "$smtPath\*" -xr!"node_modules" -xr!".git" | Out-Null
    Write-Host "  Project exported (7z)" -ForegroundColor Green
} else {
    # Fallback to PowerShell Compress-Archive
    Get-ChildItem $smtPath -Exclude node_modules,.git | Compress-Archive -DestinationPath $projectZip -Force
    Write-Host "  Project exported (zip)" -ForegroundColor Green
}

# 4. Export station systems
Write-Host "`n[4/4] Exporting station systems..." -ForegroundColor Yellow
$stationsZip = Join-Path $BackupPath "stations.zip"
$stationsPath = Join-Path $ProjectPath "瑞晶越南工位-正式命名"

if (Test-Path $stationsPath) {
    if (Test-Path $sevenZip) {
        & $sevenZip a -tzip -mx=9 $stationsZip "$stationsPath\*" | Out-Null
    } else {
        Compress-Archive -Path $stationsPath -DestinationPath $stationsZip -Force
    }
    Write-Host "  Stations exported" -ForegroundColor Green
}

# Summary
Write-Host "`n=== Export Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backup files:" -ForegroundColor White
Get-ChildItem $BackupPath | ForEach-Object {
    $size = "{0:N2} MB" -f ($_.Length / 1MB)
    Write-Host "  $($_.Name) - $size" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Copy '$BackupPath' folder to target computer, then run migrate-system.ps1" -ForegroundColor Yellow
