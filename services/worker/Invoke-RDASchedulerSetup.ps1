# RDA Scheduler Setup — registers Windows Task Scheduler jobs for the RDA Manager
# Run as: powershell -ExecutionPolicy Bypass -File Invoke-RDASchedulerSetup.ps1

$ErrorActionPreference = "Stop"
$workerDir = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\services\worker"
$shortWorkerDir = "\\?\$workerDir"  # 8.3 short path to avoid Chinese chars in schtasks

# Find 8.3 short path for worker dir
$vol = Split-Path $workerDir -Qualifier
$rel = $workerDir.Substring($vol.Length + 1)
$shortDir = @($vol, ($vol | Get-PSProvider).fsroot | ForEach-Object { (cmd /c dir /x $_.TrimEnd('\') 2>$null | Select-Object -Last 1 | ForEach-Object { $_.Trim().Split()[0] })) -join '\'

# Get short paths for the scripts
$patrolPath   = "$shortWorkerDir\Invoke-RDAPatrol.ps1"
$archivePath  = "$shortWorkerDir\Invoke-RDAArchive.ps1"
$digestPath   = "$shortWorkerDir\Invoke-RDADigest.ps1"

$taskPrefix = "RDA_Manager"

function New-RDATask {
  param($name, $script, $schedule, $frequency, $description)

  $taskName = "$taskPrefix\$name"
  $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue

  if ($existing) {
    Write-Host "[RDA Scheduler] Removing existing task: $name"
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }

  $trigger = switch ($frequency) {
    "minute30" { New-ScheduledTaskTrigger -Once -At (Get-Date) -ReputationInterval 30 -RepeatInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 9999) }
    "daily"    { New-ScheduledTaskTrigger -Daily -At "23:00" }
    "weekly"   { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "23:00" }
    "monthly"  { New-ScheduledTaskTrigger -Daily -At "23:00" }  # Daily, script checks calendar
  }

  $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File `"$script`""

  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false

  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

  Write-Host "[RDA Scheduler] Registering: $name ($frequency) -> $script"
  Register-ScheduledTask -TaskName $name -Trigger $trigger -Action $action `
    -Settings $settings -Principal $principal -Description $description | Out-Null
}

Write-Host "========================================"
Write-Host "  RDA Manager — Scheduler Setup"
Write-Host "========================================"
Write-Host "Worker directory: $workerDir"
Write-Host ""

# Create task folder
$tf = Get-ScheduledTaskFolder -Path "\$taskPrefix" -ErrorAction SilentlyContinue
if (-not $tf) {
  New-ScheduledTaskFolder -Path "\$taskPrefix" | Out-Null
  Write-Host "Created task folder: \$taskPrefix"
}

# RDA Patrol: every 30 minutes
New-RDATask -name "$taskPrefix\Patrol_30min" `
  -script $patrolPath -frequency "minute30" `
  -description "RDA Manager patrol: checks archive health, missing data, anomalies. Every 30 minutes."

# RDA Archive: daily at 23:00 (weekly on Sunday, monthly on 1st)
New-RDATask -name "$taskPrefix\Archive_Daily" `
  -script $archivePath -frequency "daily" `
  -description "RDA Manager daily archive of all 16 reports at 23:00. Also runs weekly (Sun) and monthly (1st) snapshots."

# RDA Morning Digest: 07:30 daily
New-RDATask -name "$taskPrefix\Digest_0730" `
  -script $digestPath -frequency "daily" `
  -description "RDA Manager morning digest to LINE at 07:30 with archive health summary."

Write-Host ""
Write-Host "All tasks registered. List tasks with:"
Write-Host "  Get-ScheduledTask | Where-Object { `$_.TaskName -like '$taskPrefix*' }"
Write-Host ""
Write-Host "Uninstall with:"
Write-Host "  Get-ScheduledTask | Where-Object { `$_.TaskName -like '$taskPrefix*' } | Unregister-ScheduledTask -Confirm:`$false"
Write-Host "========================================"
