# Uncomment hot_standby
$conf = Get-Content "C:\PostgreSQL\data\postgresql.conf" -Raw
$conf = $conf -replace "(?m)^(\s*)#(\s*hot_standby\s*=\s*on)", "`$1`$2"
$conf | Set-Content "C:\PostgreSQL\data\postgresql.conf"

# Send SIGHUP to reload config (or restart via task)
# Since we're using Task Scheduler, we stop and restart the task
Stop-ScheduledTask -TaskName PostgreSQL_Standby -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName PostgreSQL_Standby
Start-Sleep -Seconds 5

Write-Host "PostgreSQL reloaded"
