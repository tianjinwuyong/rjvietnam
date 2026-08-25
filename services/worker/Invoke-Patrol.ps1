<#
.SYNOPSIS
  全面巡检 — 同时运行 BOM, PDA, SOP 巡检并汇总报告.
.DESCRIPTION
  Orchestrates all three checks (BOM/PDA/SOP) and consolidates the output.
.PARAMETER OutputFile
  Path to write the patrol report (JSON). Default: patrol-report.json
.EXAMPLE
  .\Invoke-Patrol.ps1
  .\Invoke-Patrol.ps1 -OutputFile C:\temp\report.json
#>

param(
  [string] $OutputFile = "patrol-report.json"
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  全面巡检 (Patrol)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

$report = @{
  timestamp = (Get-Date -Format "o")
  checks    = @{}
  hasIssues = $false
}

# ---- BOM Check ----
Write-Host ">>> [1/4] BOM 巡检 <<<" -ForegroundColor Cyan
try {
  $bomOut = & "$Worker\Invoke-BOMCheck.ps1" 2>&1
  $bomOut | ForEach-Object { Write-Host $_ }
  $report.checks.BOM = "完成"
}
catch {
  Write-Host "  BOM 巡检失败: $_" -ForegroundColor Red
  $report.checks.BOM = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- PDA Check ----
Write-Host ">>> [2/4] PDA 巡检 <<<" -ForegroundColor Cyan
try {
  $pdaOut = & "$Worker\Invoke-PDACheck.ps1" 2>&1
  $pdaOut | ForEach-Object { Write-Host $_ }
  $report.checks.PDA = "完成"
}
catch {
  Write-Host "  PDA 巡检失败: $_" -ForegroundColor Red
  $report.checks.PDA = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- SOP Check ----
Write-Host ">>> [3/4] SOP 巡检 <<<" -ForegroundColor Cyan
try {
  $sopOut = & "$Worker\Invoke-SOPCheck.ps1" -Detail 2>&1
  $sopOut | ForEach-Object { Write-Host $_ }
  $report.checks.SOP = "完成"
}
catch {
  Write-Host "  SOP 巡检失败: $_" -ForegroundColor Red
  $report.checks.SOP = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- HR Check ----
Write-Host ">>> [4/4] HR 巡检 <<<" -ForegroundColor Cyan
try {
  $hrOut = & "$Worker\Invoke-HRPatrol.ps1" 2>&1
  $hrOut | ForEach-Object { Write-Host $_ }
  if ($hrOut -match "存在待处理问题") {
    $report.hasIssues = $true
  }
  $report.checks.HR = "完成"
}
catch {
  Write-Host "  HR 巡检失败: $_" -ForegroundColor Red
  $report.checks.HR = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- Summary ----
Write-Host "========================================" -ForegroundColor Magenta
if ($report.hasIssues) {
  Write-Host "  巡检完成 — ⚠ 存在待处理问题" -ForegroundColor Yellow
}
else {
  Write-Host "  巡检完成 — ✅ 一切正常" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Magenta

# Save report
$reportJson = $report | ConvertTo-Json -Depth 3
$reportPath = Join-Path $Worker $OutputFile
Set-Content -Path $reportPath -Value $reportJson -Encoding UTF8
Write-Host ""
Write-Host "报告已保存: $reportPath" -ForegroundColor DarkGray
