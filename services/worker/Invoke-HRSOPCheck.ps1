<#
.SYNOPSIS
  HR SOP 状态巡检 — 检查 hr-sop-state.json 中各步骤版本与状态.
.DESCRIPTION
  Reads hr-sop-state.json, checks for pending approvals or execution status.
.PARAMETER Detail
  Show per-step details.
.EXAMPLE
  .\Invoke-HRSOPCheck.ps1 -Detail
#>

param(
  [switch] $Detail
)

$Root    = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root "services\worker"
$StateFile = Join-Path $DataDir "hr-sop-state.json"
$PendingFile = Join-Path $DataDir "hr-pending-approvals.json"

Write-Host "=== HR SOP 状态巡检 ===" -ForegroundColor Cyan

# Check pending approvals first
if (Test-Path $PendingFile) {
  try {
    $pending = Get-Content $PendingFile -Raw | ConvertFrom-Json
    $total = $pending.leave.Count + $pending.overtime.Count + $pending.attendance.Count
    if ($total -gt 0) {
      Write-Host "  ⚠ 待审批: $total 项" -ForegroundColor Yellow
      if ($Detail) {
        if ($pending.leave.Count -gt 0) {
          Write-Host "    [请假] $($pending.leave.Count) 条" -ForegroundColor Yellow
          $pending.leave | ForEach-Object { Write-Host "      - $($_.request_no) → $($_.decision)" }
        }
        if ($pending.overtime.Count -gt 0) {
          Write-Host "    [加班] $($pending.overtime.Count) 条" -ForegroundColor Yellow
        }
        if ($pending.attendance.Count -gt 0) {
          Write-Host "    [考勤] $($pending.attendance.Count) 条" -ForegroundColor Yellow
        }
      }
    }
    else {
      Write-Host "  ✅ 无待审批项" -ForegroundColor Green
    }
  }
  catch {
    Write-Host "  hr-pending-approvals.json 解析失败" -ForegroundColor Red
  }
}
else {
  Write-Host "  hr-pending-approvals.json 不存在 — 无待审批" -ForegroundColor DarkGray
}

# Check SOP state
if (Test-Path $StateFile) {
  try {
    $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    $lastCycle = $state.lastCycle
    if ($lastCycle) {
      $lastTime = [DateTime]::Parse($lastCycle)
      $hoursAgo = [Math]::Round(((Get-Date) - $lastTime).TotalHours, 1)
      Write-Host "  🕐 末次巡逻: $hoursAgo 小时前" -ForegroundColor $(if ($hoursAgo -gt 2) { "Yellow" } else { "DarkGray" })
    }
    
    $stepCount = 0
    if ($state.stepHistoryMap) {
      $stepCount = $state.stepHistoryMap.PSObject.Properties.Count
      Write-Host "  📋 已执行步骤: $stepCount" -ForegroundColor DarkGray
    }
  }
  catch {
    Write-Host "  hr-sop-state.json 解析失败" -ForegroundColor Red
  }
}
else {
  Write-Host "  hr-sop-state.json 不存在 — 运行 patrol 后生成" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "HR SOP 巡检完成。" -ForegroundColor Green
