# Invoke-RDAArchive.ps1
# RDA Manager Daily Archive — scheduled at 23:00 daily
# Archives all 16 reports for the day + weekly on Sunday, monthly on 1st

$ErrorActionPreference = "Stop"
$repoRoot = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
$workerDir = "$repoRoot\services\worker"
$logFile = "$workerDir\rda-archive.log"

$now = Get-Date
$isSunday = $now.DayOfWeek -eq "Sunday"
$isFirstOfMonth = $now.Day -eq 1

function Write-Log {
  param($msg)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$ts  $msg" | Tee-Object -FilePath $logFile -Append
}

Write-Log "=== RDA Archive Start ==="
Write-Log "Day=$($now.ToString('yyyy-MM-dd')) Sunday=$isSunday FirstOfMonth=$isFirstOfMonth"

# Run daily snapshot
Write-Log "Running daily archive..."
$daily = & node "$workerDir\rda-manager.js" archive-daily 2>&1
Write-Log "Daily: $daily"

if ($isSunday) {
  Write-Log "Running weekly archive (Sunday)..."
  $weekly = & node "$workerDir\rda-manager.js" archive-weekly 2>&1
  Write-Log "Weekly: $weekly"
}

if ($isFirstOfMonth) {
  Write-Log "Running monthly archive (1st of month)..."
  $monthly = & node "$workerDir\rda-manager.js" archive-monthly 2>&1
  Write-Log "Monthly: $monthly"
}

Write-Log "=== RDA Archive Complete ==="
