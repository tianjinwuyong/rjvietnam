Write-Host "=== PROCESSES ==="
Get-Process | Where-Object { $_.Name -match "postgres" } | Select-Object Name,Id
Write-Host "=== PORT 5432 ==="
netstat -ano | Where-Object { $_ -match ":5432" }
Write-Host "=== TASK INFO ==="
Get-ScheduledTaskInfo -TaskName PostgreSQL_Standby | Select-Object LastTaskResult,LastRunTime,NumberOfMissedRuns,LastError
