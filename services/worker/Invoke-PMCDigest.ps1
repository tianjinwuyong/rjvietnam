<#
.SYNOPSIS
  PMC AI Manager 晨报 — 生成 PMC 日报并发送至 LINE.
.DESCRIPTION
  Calls pmc-execute.js pmc-digest to generate and send daily PMC report.
.PARAMETER SkipLine
  Skip LINE notification; just print to console.
.EXAMPLE
  .\Invoke-PMCDigest.ps1
  .\Invoke-PMCDigest.ps1 -SkipLine
#>

param(
  [switch] $SkipLine
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "=== PMC Daily Digest ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Write-Host ""

# Run PMC digest
Write-Host "[1/1] Running PMC digest..." -ForegroundColor Cyan
try {
  $digest = & $Node "$Worker\pmc-execute.js" pmc-digest 2>&1
  $digest | ForEach-Object { Write-Host $_ }
}
catch {
  Write-Host "  (pmc-execute not available)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "PMC Digest complete." -ForegroundColor Green