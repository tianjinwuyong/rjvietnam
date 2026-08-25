<#
.SYNOPSIS
  PMC AI Manager 自动巡检.
.DESCRIPTION
  Runs pmc-query.js patrol and pmc-execute.js patrol, reports issues.
.PARAMETER ReportOnly
  If set, only prints the report without LINE alerts.
.EXAMPLE
  .\Invoke-PMCCheck.ps1
#>

param(
  [switch] $ReportOnly
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "=== PMC 自动巡检 ===" -ForegroundColor Cyan

# 1) WO Summary
Write-Host "[1/5] WO Summary..." -NoNewline
$woRaw = & $Node "$Worker\pmc-query.js" wo-list 2>$null
$wo    = $woRaw | ConvertFrom-Json
$wos   = $wo.work_orders ?? @()
$running   = ($wos | Where-Object { $_.status -eq "running" }).Count
$released  = ($wos | Where-Object { $_.status -eq "released" }).Count
$draft     = ($wos | Where-Object { $_.status -eq "draft" }).Count
$onHold    = ($wos | Where-Object { $_.status -eq "on_hold" }).Count
Write-Host " running=$running released=$released draft=$draft on_hold=$onHold"

# 2) Kit Readiness
Write-Host "[2/5] Kit Readiness..." -NoNewline
$kitRaw = & $Node "$Worker\pmc-query.js" kit-readiness 2>$null
$kit    = $kitRaw | ConvertFrom-Json
$kitWos = $kit.wos ?? @()
$kitReady    = ($kitWos | Where-Object { $_.kit_ready_pct -ge 100 }).Count
$kitPartial  = ($kitWos | Where-Object { $_.kit_ready_pct -ge 50 -and $_.kit_ready_pct -lt 100 }).Count
$kitShortage = ($kitWos | Where-Object { $_.kit_ready_pct -lt 50 }).Count
Write-Host " ready=$kitReady partial=$kitPartial shortage=$kitShortage"

# 3) Delivery Status
Write-Host "[3/5] Delivery Status..." -NoNewline
$delRaw = & $Node "$Worker\pmc-query.js" delivery-status 2>$null
$del    = $delRaw | ConvertFrom-Json
$delSummary = $del.summary ?? @{}
Write-Host " on_time=$($delSummary.on_time ?? 0) at_risk=$($delSummary.at_risk ?? 0) critical=$($delSummary.critical ?? 0)"

# 4) Capacity Analysis
Write-Host "[4/5] Capacity Analysis..." -NoNewline
$capRaw = & $Node "$Worker\pmc-query.js" capacity-analysis 2>$null
$cap    = $capRaw | ConvertFrom-Json
$capSummary = $cap.summary ?? @{}
Write-Host " high_load=$($capSummary.high_load ?? 0) available=$($capSummary.available ?? 0) normal=$($capSummary.normal ?? 0)"

# 5) Shortage List
Write-Host "[5/5] Shortage List..." -NoNewline
$shortRaw = & $Node "$Worker\pmc-query.js" shortage-list 2>$null
$short    = $shortRaw | ConvertFrom-Json
$shortSummary = $short.summary ?? @{}
Write-Host " total=$($shortSummary.total_shortage_items ?? 0) items"

$issues = $kitShortage + ($delSummary.at_risk ?? 0) + ($delSummary.critical ?? 0) + ($capSummary.high_load ?? 0)

if ($issues -gt 0) {
  Write-Host ""
  Write-Host "=== Summary ===" -ForegroundColor Yellow
  if ($kitShortage -gt 0)     { Write-Host "  Kit shortage: $kitShortage WOs" -ForegroundColor Yellow }
  if (($delSummary.at_risk ?? 0) -gt 0) { Write-Host "  Delivery at risk: $($delSummary.at_risk)" -ForegroundColor Yellow }
  if (($delSummary.critical ?? 0) -gt 0) { Write-Host "  Delivery critical: $($delSummary.critical)" -ForegroundColor Yellow }
  if (($capSummary.high_load ?? 0) -gt 0) { Write-Host "  High load lines: $($capSummary.high_load)" -ForegroundColor Yellow }
}
else {
  Write-Host ""
  Write-Host "All clear, no issues found." -ForegroundColor Green
}