$taskName = "PostgreSQL_Standby"

# Unregister existing
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create action with LC_ALL=C environment
$action = New-ScheduledTaskAction -Execute "C:\PostgreSQL\pgsql\bin\postgres.exe" -Argument "-D C:\PostgreSQL\data" -WorkingDirectory "C:\PostgreSQL\data"

# Trigger - at logon (will run now since it's already registered)
$trigger = New-ScheduledTaskTrigger -AtLogOn

# Principal - run as SYSTEM
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::FromHours(1))

# Register
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "PostgreSQL Standby"

# Run NOW
Start-ScheduledTask -TaskName $taskName

Write-Host "Task started"
Start-Sleep -Seconds 10

# Check
$proc = Get-Process postgres -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "Running: $($proc.Count) processes"
} else {
    Write-Host "Not running"
}
