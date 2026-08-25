<#
.SYNOPSIS
  HR全面巡检 — 运行HR Manager Patrol并输出报告.
.DESCRIPTION
  Calls hr-manager.js patrol cycle and consolidates HR patrol report.
.PARAMETER OutputFile
  Path to write the HR patrol report (JSON). Default: hr-patrol-report.json
.EXAMPLE
  .\Invoke-HRPatrol.ps1
  .\Invoke-HRPatrol.ps1 -OutputFile C:\temp\hr-report.json
#>

param(
  [string] $OutputFile = "hr-patrol-report.json"
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  HR 全面巡检 (Patrol)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

$report = @{
  timestamp = (Get-Date -Format "o")
  checks    = @{}
  hasIssues = $false
}

# ---- HR Query Check ----
Write-Host ">>> [1/3] HR 数据查询 <<<" -ForegroundColor Cyan
try {
  $queryOut = & $Node "$Worker\hr-query.js" all 2>&1
  $data = $queryOut | Out-String | ConvertFrom-Json
  $report.checks.Query = "完成 ($($data.dashboard.activeEmployees)员工)"
}
catch {
  Write-Host "  HR 数据查询失败: $_" -ForegroundColor Red
  $report.checks.Query = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- HR Manager Patrol ----
Write-Host ">>> [2/3] HR Manager 巡逻 <<<" -ForegroundColor Cyan
try {
  $patrolOut = & $Node "$Worker\hr-manager.js" patrol 2>&1
  $patrolOut | ForEach-Object { Write-Host "  $_" }
  $report.checks.Patrol = "完成"
}
catch {
  Write-Host "  HR 巡逻失败: $_" -ForegroundColor Red
  $report.checks.Patrol = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- HR Compliance Check ----
Write-Host ">>> [3/3] HR 合规检查 <<<" -ForegroundColor Cyan
try {
  $compOut = & $Node "$Worker\hr-query.js" compliance 2>&1
  $compData = $compOut | Out-String | ConvertFrom-Json
  if ($compData.compliance.missingSi.Count -gt 0 -or $compData.compliance.expiredContracts.Count -gt 0) {
    Write-Host "  ⚠ 发现合规问题" -ForegroundColor Yellow
    if ($compData.compliance.missingSi.Count -gt 0) {
      Write-Host "    - 缺少社保号: $($compData.compliance.missingSi.Count)人" -ForegroundColor Yellow
    }
    if ($compData.compliance.expiredContracts.Count -gt 0) {
      Write-Host "    - 合同过期: $($compData.compliance.expiredContracts.Count)人" -ForegroundColor Yellow
    }
    $report.hasIssues = $true
  }
  else {
    Write-Host "  ✅ 合规检查通过" -ForegroundColor Green
  }
  $report.checks.Compliance = "完成"
}
catch {
  Write-Host "  HR 合规检查失败: $_" -ForegroundColor Red
  $report.checks.Compliance = "失败: $_"
  $report.hasIssues = $true
}
Write-Host ""

# ---- Summary ----
Write-Host "========================================" -ForegroundColor Magenta
if ($report.hasIssues) {
  Write-Host "  HR 巡检完成 — ⚠ 存在待处理问题" -ForegroundColor Yellow
}
else {
  Write-Host "  HR 巡检完成 — ✅ 一切正常" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Magenta

# Save report
$reportJson = $report | ConvertTo-Json -Depth 3
$reportPath = Join-Path $Worker $OutputFile
Set-Content -Path $reportPath -Value $reportJson -Encoding UTF8
Write-Host ""
Write-Host "报告已保存: $reportPath" -ForegroundColor DarkGray
