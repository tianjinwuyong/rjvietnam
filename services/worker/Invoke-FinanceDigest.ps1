# Invoke-FinanceDigest.ps1
# Finance AI Manager — daily morning digest (AI summary sent to LINE)
# Usage: Invoke-FinanceDigest.ps1 [-WebhookUrl "https://..."]
param(
    [string]$WebhookUrl = ""
)

$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " Finance AI Manager — Morning Digest  $timestamp" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan

# Run finance-manager.js morning digest (sends LINE notification)
$nodePath = if (Test-Path "C:\Program Files\nodejs\node.exe") { "node" } else { "node.exe" }
$managerPath = Join-Path $PSScriptRoot "finance-manager.js"

Write-Host "[MANAGER] Generating morning financial digest..." -ForegroundColor Gray
$output = & node $managerPath morning 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host "⚠️  Morning digest error (exit $exitCode): $output" -ForegroundColor Red
} else {
    Write-Host "✅ Morning digest sent to LINE" -ForegroundColor Green
    $output | ForEach-Object { Write-Host $_ }
}

# Also pass to webhook if configured
if ($WebhookUrl) {
    $body = @{
        timestamp = $timestamp
        scope = "morning_digest"
        raw_output = ($output | Out-String).Trim()
    } | ConvertTo-Json -Depth 3
    try {
        Invoke-RestMethod -Uri $WebhookUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 15 -ErrorAction SilentlyContinue
        Write-Host "📡 Digest sent to webhook" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Webhook failed: $_" -ForegroundColor Yellow
    }
}

Write-Host "Digest complete." -ForegroundColor Green
exit $exitCode
