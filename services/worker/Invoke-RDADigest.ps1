# Invoke-RDADigest.ps1
# RDA Manager Morning Digest — scheduled at 07:30 daily
# Sends LINE notification with archive health + insights summary

$ErrorActionPreference = "SilentlyContinue"
$repoRoot = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
$workerDir = "$repoRoot\services\worker"

Write-Host "[RDA Digest] Starting morning digest..."

# Run patrol + insights
$patrol = & node "$workerDir\rda-manager.js" patrol 2>&1
$insights = & node "$workerDir\rda-manager.js" insights --days 7 2>&1

# Format LINE message
$lineMsg = @"
[RDA 晨报] $(Get-Date -Format "yyyy-MM-dd HH:mm")
━━━━━━━━━━━━━━━━━━
📊 归档概览
  来源: $($insights.archiveSummary.totalSources) 个报表
  记录: $($insights.archiveSummary.totalArchives) 条归档
  数据行: $($insights.archiveSummary.totalRows) 行
━━━━━━━━━━━━━━━━━━
"@

foreach ($cat in $insights.archiveSummary.byCategory | Select-Object -First 5) {
  $lineMsg += "`n  $($cat.name_zh): $($cat.cnt) 条"
}

if ($insights.retentionInfo.expiringIn30Days -gt 0) {
  $lineMsg += "`n━━━━━━━━━━━━━━━━━━"
  $lineMsg += "`n⚠️  即将过期: $($insights.retentionInfo.expiringIn30Days) 条"
}

$lineMsg += "`n━━━━━━━━━━━━━━━━━━"
$lineMsg += "`n[Report Data Analysis Manager]"

# Send LINE notification
$tokenPath = "$workerDir\line_token.txt"
if (Test-Path $tokenPath) {
  $token = Get-Content $tokenPath -Raw
  try {
    $body = @{ message = $lineMsg } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "https://notify-api.line.me/api/notify" `
      -Method POST `
      -Headers @{ Authorization = "Bearer $token.trim()" } `
      -Body $body `
      -ContentType "application/json" | Out-Null
    Write-Host "[RDA Digest] LINE notification sent."
  } catch {
    Write-Host "[RDA Digest] LINE send failed: $_"
  }
} else {
  Write-Host "[RDA Digest] No LINE token — skipping notification."
  Write-Host $lineMsg
}

Write-Host "[RDA Digest] Done."
