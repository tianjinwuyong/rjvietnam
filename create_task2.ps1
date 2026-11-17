$taskName = "PostgreSQL_Standby"

# Remove existing task
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create action - run as SYSTEM (highest privileges)
$action = New-ScheduledTaskAction -Execute "C:\PostgreSQL\pgsql\bin\postgres.exe" -Argument "-D C:\PostgreSQL\data" -WorkingDirectory "C:\PostgreSQL\data"

# Trigger - at system startup
$trigger = New-ScheduledTaskTrigger -AtStartup

# Principal - run as SYSTEM
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::FromHours(1))

# Register
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "PostgreSQL Standby"
Write-Host "Task registered"

# Run it now
Start-ScheduledTask -TaskName $taskName
Write-Host "Task started"
Start-Sleep -Seconds 10
