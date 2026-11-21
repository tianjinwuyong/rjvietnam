$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$script = Join-Path $root 'watchdog.ps1'
$taskName = 'SMT-Factory-Watchdog'

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
  -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal `
  -Description 'Ruijing MES API and frontend watchdog' | Out-Null
Write-Output "Registered $taskName for system startup."
