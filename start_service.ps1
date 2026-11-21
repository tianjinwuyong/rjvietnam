Start-Service -Name PostgreSQL_Standby
Start-Sleep -Seconds 10
$svc = Get-Service -Name PostgreSQL_Standby
Write-Host "Status: $($svc.Status)"
