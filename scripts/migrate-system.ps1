# SMT Factory System - Migration Script
# Run on TARGET computer after copying files

param(
    [string]$SourceBackupPath = "C:\backup",
    [string]$InstallPath = "C:\smt-factory",
    [string]$DbPassword = "postgres",
    [string]$ApiPort = "8080"
)

$ErrorActionPreference = "Stop"

Write-Host "=== SMT Factory Migration Script ===" -ForegroundColor Cyan

# 1. Check prerequisites
Write-Host "`n[1/6] Checking prerequisites..." -ForegroundColor Yellow

$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Error "Node.js not found. Please install Node.js 18+ first."
    exit 1
}
Write-Host "  Node.js: $nodeVersion"

$psqlVersion = psql --version 2>$null
if (-not $psqlVersion) {
    Write-Error "PostgreSQL not found. Please install PostgreSQL 14+ first."
    exit 1
}
Write-Host "  PostgreSQL: $psqlVersion"

# 2. Create directories
Write-Host "`n[2/6] Creating directories..." -ForegroundColor Yellow
$stationPath = Join-Path $InstallPath "瑞晶越南工位-正式命名"
New-Item -ItemType Directory -Force -Path $InstallPath, $stationPath | Out-Null

# 3. Restore database
Write-Host "`n[3/6] Restoring database..." -ForegroundColor Yellow
$dumpFile = Join-Path $SourceBackupPath "smt_factory.dump"
if (Test-Path $dumpFile) {
    # Drop and recreate database
    $env:PGPASSWORD = $DbPassword
    psql -U postgres -c "DROP DATABASE IF EXISTS smt_factory;" 2>$null
    psql -U postgres -c "CREATE DATABASE smt_factory;"
    pg_restore -U postgres -d smt_factory $dumpFile
    Write-Host "  Database restored successfully" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Database dump not found at $dumpFile" -ForegroundColor Yellow
    Write-Host "  Database will be created fresh via migrations" -ForegroundColor Yellow
}

# 4. Extract project files
Write-Host "`n[4/6] Extracting project files..." -ForegroundColor Yellow
$projectZip = Join-Path $SourceBackupPath "smt-factory-system.zip"
if (Test-Path $projectZip) {
    Expand-Archive -Path $projectZip -DestinationPath $InstallPath -Force
    Write-Host "  Project extracted" -ForegroundColor Green
}

$stationsZip = Join-Path $SourceBackupPath "stations.zip"
if (Test-Path $stationsZip) {
    Expand-Archive -Path $stationsZip -DestinationPath $InstallPath -Force
    Write-Host "  Stations extracted" -ForegroundColor Green
}

# 5. Install dependencies
Write-Host "`n[5/6] Installing dependencies..." -ForegroundColor Yellow
Set-Location (Join-Path $InstallPath "smt-factory-system")
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Dependencies installed" -ForegroundColor Green
}

# 6. Configure and run migrations
Write-Host "`n[6/6] Configuring and running migrations..." -ForegroundColor Yellow

# Create .env if not exists
$envFile = Join-Path $InstallPath "smt-factory-system\.env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $InstallPath "smt-factory-system\.env.example") $envFile
}

# Update .env with correct values
$envContent = Get-Content $envFile -Raw
$envContent = $envContent -replace 'PGPASSWORD=.*', "PGPASSWORD=$DbPassword"
$envContent = $envContent -replace 'API_PORT=.*', "API_PORT=$ApiPort"
$envContent = $envContent -replace 'PGHOST=.*', "PGHOST=127.0.0.1"
Set-Content -Path $envFile -Value $envContent

# Run migrations
$env:PGPASSWORD = $DbPassword
npm run migrate
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Migrations completed" -ForegroundColor Green
}

Write-Host "`n=== Migration Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the system:" -ForegroundColor White
Write-Host "  cd $InstallPath\smt-factory-system" -ForegroundColor Gray
Write-Host "  node start_dev.js" -ForegroundColor Gray
Write-Host ""
Write-Host "Access:" -ForegroundColor White
Write-Host "  Web UI: http://localhost:$ApiPort" -ForegroundColor Gray
Write-Host "  API: http://localhost:$ApiPort/api" -ForegroundColor Gray
