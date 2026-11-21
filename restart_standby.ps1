# Restart PostgreSQL via Task Scheduler
Stop-ScheduledTask -TaskName PostgreSQL_Standby -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName PostgreSQL_Standby
Start-Sleep -Seconds 8

# Check task status
$info = Get-ScheduledTaskInfo -TaskName PostgreSQL_Standby
Write-Host "LastResult: $($info.LastTaskResult)"
Write-Host "LastRunTime: $($info.LastRunTime)"

# Check if postgres process is running
$proc = Get-Process postgres -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "PostgreSQL running: $($proc.Count) processes"
} else {
    Write-Host "No postgres process"
}

# Check listening ports
$listening = netstat -ano | Where-Object { $_ -match ":5432.*LISTENING" }
Write-Host "Port 5432: $listening"
