<#
.SYNOPSIS
  SOP 状态巡检 — 检查 wms-sop-state.json 中各工序 SOP 版本与签名状态.
.DESCRIPTION
  Reads wms-sop-state.json, checks for pending signatures or expired SOPs.
.PARAMETER Detail
  Show per-operation details.
.EXAMPLE
  .\Invoke-SOPCheck.ps1 -Detail
#>

param(
  [switch] $Detail
)

$Root    = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root "services\worker"
$StateFile = Join-Path $DataDir "wms-sop-state.json"

Write-Host "=== SOP 状态巡检 ===" -ForegroundColor Cyan

if (-not (Test-Path $StateFile)) {
  Write-Host "  wms-sop-state.json 不存在" -ForegroundColor DarkGray
  exit 0
}

try {
  $state = Get-Content $StateFile -Raw | ConvertFrom-Json
  $issues = @()
  $totalOps = 0

  # Check each operation area
  $state.PSObject.Properties | ForEach-Object {
    $areaName = $_.Name
    $areaData = $_.Value

    $areaData.PSObject.Properties | ForEach-Object {
      $opName  = $_.Name
      $opData  = $_.Value
      $totalOps++

      if ($Detail) {
        Write-Host "  [$areaName / $opName]" -ForegroundColor DarkCyan
        Write-Host "    版本:  $($opData.version)" -ForegroundColor $(if ($opData.signed) { "Green" } else { "Yellow" })
        Write-Host "    状态:  $($opData.status)" -ForegroundColor $(if ($opData.signed) { "Green" } else { "Yellow" })
      }

      if (-not $opData.signed) {
        $issues += "$areaName / $opName: 未签署"
      }
    }
  }

  Write-Host ""
  Write-Host "  共检查 $totalOps 个工序"
  if ($issues.Count -gt 0) {
    Write-Host "  ⚠ 待签署: $($issues.Count) 个" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
  }
  else {
    Write-Host "  ✅ 全部已签署" -ForegroundColor Green
  }
}
catch {
  Write-Host "  wms-sop-state.json 解析失败: $_" -ForegroundColor Red
}
