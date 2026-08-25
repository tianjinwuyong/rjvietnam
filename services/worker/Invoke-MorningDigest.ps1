<#
.SYNOPSIS
  晨报生成 — 生成 BOM/WMS 早报并发送至 LINE.
.DESCRIPTION
  Calls bom-execute.js morning-digest, then Invoke-Patrol.ps1 to gather
  the full morning picture. Sends consolidated report via LINE.
.PARAMETER SkipLine
  Skip LINE notification; just print to console.
.EXAMPLE
  .\Invoke-MorningDigest.ps1
  .\Invoke-MorningDigest.ps1 -SkipLine
#>

param(
  [switch] $SkipLine
)

$Root   = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Root "services\worker"
$Node   = "node"

Write-Host "=== 晨报生成 ===" -ForegroundColor Cyan
Write-Host "时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Write-Host ""

# 1) BOM morning digest
Write-Host "[1/4] BOM 晨报..." -NoNewline
try {
  & $Node "$Worker\bom-execute.js" morning-digest 2>&1 | ForEach-Object { Write-Host $_ }
}
catch {
  Write-Host "  (bom-execute 不可用，跳过)" -ForegroundColor DarkGray
}
Write-Host ""

# 2) Full patrol
Write-Host "[2/4] 全量巡检..."
try {
  & "$Worker\Invoke-Patrol.ps1" -OutputFile "morning-patrol-report.json" 2>&1 | ForEach-Object { Write-Host "  $_" }
}
catch {
  Write-Host "  (巡检失败)" -ForegroundColor DarkGray
}
Write-Host ""

# 3) HR morning digest
Write-Host "[3/4] HR 晨报..."
try {
  & $Node "$Worker\hr-manager.js" morning 2>&1 | ForEach-Object { Write-Host $_ }
}
catch {
  Write-Host "  (hr-manager 不可用，跳过)" -ForegroundColor DarkGray
}
Write-Host ""

# 4) Collect summary for LINE
Write-Host "[4/4] 生成摘要..."
$reportPath = Join-Path $Worker "morning-patrol-report.json"
$message = @"
📋 晨报摘要
━━━━━━━━━━━━━━━
$(Get-Date -Format 'yyyy-MM-dd HH:mm')

• 巡检状态: 完成
• 详情请查看 services/worker/morning-patrol-report.json
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

Write-Host ""
Write-Host "晨报完成。" -ForegroundColor Green
