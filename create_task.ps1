# Register PostgreSQL as a Task Scheduler task to run as the logged-on user
$taskName = "PostgreSQL_Standby"

# First remove existing task
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create action - run as current user (wy)
$action = New-ScheduledTaskAction -Execute "C:\PostgreSQL\pgsql\bin\postgres.exe" -Argument "-D C:\PostgreSQL\data" -WorkingDirectory "C:\PostgreSQL\data"

# Trigger - at logon of the user
$trigger = New-ScheduledTaskTrigger -AtLogOn

# Principal - run as the user (will prompt or use default)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "PostgreSQL Standby for streaming replication"
Write-Host "Task registered"

# Run it now
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 5

# Check if running
$tasks = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Write-Host "Task State: $($tasks.State)"
