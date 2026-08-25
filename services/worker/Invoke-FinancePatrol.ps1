# Invoke-FinancePatrol.ps1
# Finance AI Manager — 15-minute patrol check
# Usage: Invoke-FinancePatrol.ps1 [-WebhookUrl "https://..."]
param(
    [string]$WebhookUrl = ""
)

$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " Finance AI Manager — Patrol Check  $timestamp" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan

# Run finance-manager.js patrol cycle
$nodePath = if (Test-Path "C:\Program Files\nodejs\node.exe") { "node" } else { "node.exe" }
$managerPath = Join-Path $PSScriptRoot "finance-manager.js"

Write-Host "[MANAGER] Starting Finance AI Manager patrol cycle..." -ForegroundColor Gray
$output = & node $managerPath patrol 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host "⚠️  Finance Manager error (exit $exitCode): $output" -ForegroundColor Red
} else {
    Write-Host "✅ Finance Manager patrol complete" -ForegroundColor Green
    $output | ForEach-Object { Write-Host $_ }
}

# Pass patrol result to webhook if configured
if ($WebhookUrl) {
    $body = @{
        timestamp = $timestamp
        scope = "patrol"
        raw_output = ($output | Out-String).Trim()
    } | ConvertTo-Json -Depth 3
    try {
        Invoke-RestMethod -Uri $WebhookUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10 -ErrorAction SilentlyContinue
        Write-Host "📡 Result sent to webhook" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Webhook failed: $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Patrol complete (exit $exitCode)" -ForegroundColor $(if($exitCode -eq 0){"Green"}else{"Yellow"})
exit $exitCode
