# Invoke-FinanceMonthEnd.ps1
# Finance AI Manager — month-end close procedure
# Usage: Invoke-FinanceMonthEnd.ps1 [-FiscalYear 2026] [-Period 6] [-WhatIf]
param(
    [int]$FiscalYear = (Get-Date).Year,
    [int]$Period = (Get-Date).Month,
    [switch]$WhatIf,
    [switch]$AutoPost
)

$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host " Finance AI Manager — Month-End Close $FiscalYear-$($Period.ToString().PadLeft(2,'0'))" -ForegroundColor Magenta
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Magenta

$nodePath = if (Test-Path "C:\Program Files\nodejs\node.exe") { "node" } else { "node.exe" }
$managerPath = Join-Path $PSScriptRoot "finance-manager.js"
$queryPath = Join-Path $PSScriptRoot "finance-query.js"

# Step 1: Check for draft GL entries (still do manually for visibility)
Write-Host "`n[Step 1] Checking draft GL entries..." -ForegroundColor Yellow
$draftCheck = & node $queryPath "all" 2>&1 | Select-String "Draft GL"
Write-Host ($draftCheck | Select-Object -First 3)

if ($WhatIf) {
    Write-Host "`n[WHATIF] Would run full month-end close via finance-manager.js" -ForegroundColor Cyan
    Write-Host "[WHATIF]   node finance-manager.js monthend" -ForegroundColor Cyan
} else {
    # Step 2-6: Run full month-end via finance manager
    Write-Host "`n[Step 2-6] Running month-end close via Finance AI Manager..." -ForegroundColor Yellow
    $output = & node $managerPath monthend 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        Write-Host "⚠️  Month-end failed (exit $exitCode): $output" -ForegroundColor Red
    } else {
        Write-Host "✅ Month-end close complete" -ForegroundColor Green
        $output | ForEach-Object { Write-Host $_ }
    }
}

Write-Host "`n══════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host " Month-end procedure complete" -ForegroundColor Magenta
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Magenta
exit 0
