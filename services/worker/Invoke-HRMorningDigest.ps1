<#
.SYNOPSIS
  HR晨报生成 — 生成 HR Manager 晨报并发送至 LINE.
.DESCRIPTION
  Calls hr-manager.js morning-digest command to gather HR attendance,
  leave stats and send consolidated report via LINE.
.PARAMETER SkipLine
  Skip LINE notification; just print to console.
.EXAMPLE
  .\Invoke-HRMorningDigest.ps1
  .\Invoke-HRMorningDigest.ps1 -SkipLine
#>

param(
  [switch] $SkipLine
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "=== HR 晨报生成 ===" -ForegroundColor Cyan
Write-Host "时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Write-Host ""

# 1) HR morning digest
Write-Host "[1/2] HR Manager 晨报..." -NoNewline
try {
  & $Node "$Worker\hr-manager.js" morning 2>&1 | ForEach-Object { Write-Host $_ }
}
catch {
  Write-Host "  (hr-manager 不可用，跳过)" -ForegroundColor DarkGray
}
Write-Host ""

# 2) HR query stats
Write-Host "[2/2] HR 数据统计..."
try {
  $queryOut = & $Node "$Worker\hr-query.js" dashboard 2>&1
  $data = $queryOut | Out-String | ConvertFrom-Json

  $message = @"
🌅 HR晨报摘要
━━━━━━━━━━━━━━━
$(Get-Date -Format 'yyyy-MM-dd HH:mm')

• 在职员工: $($data.dashboard.activeEmployees) 人
• 待批请假: $($data.dashboard.pendingLeaves) 条
• 待批加班: $($data.dashboard.pendingOt) 条
━━━━━━━━━━━━━━━
"@

  Write-Host $message
  Write-Host ""

  if (-not $SkipLine) {
    $tokenFile = Join-Path $Worker "line_token.txt"
    if (Test-Path $tokenFile) {
      $token = (Get-Content $tokenFile -Raw).Trim()
      if ($token) {
        try {
          $body = @{ message = $message } | ConvertTo-Json
          Invoke-RestMethod -Uri "https://notify-api.line.me/api/notify" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
            -Body $body -ErrorAction SilentlyContinue | Out-Null
          Write-Host "LINE 通知已发送" -ForegroundColor Green
        }
        catch {
          Write-Host "LINE 通知失败" -ForegroundColor DarkGray
        }
      }
    }
  }
}
catch {
  Write-Host "  (HR 数据查询失败)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "HR 晨报完成。" -ForegroundColor Green
